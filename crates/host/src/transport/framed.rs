use std::{
    error::Error,
    fmt,
    io::{self, Read, Write},
};

pub(crate) const MAX_FRAME_BYTES: usize = 4 * 1024 * 1024;

#[derive(Debug)]
pub(crate) enum FrameError {
    FrameTooLarge { size: usize, max: usize },
    TruncatedLength { read: usize },
    TruncatedFrame { expected: usize, read: usize },
    Io(io::Error),
}

impl fmt::Display for FrameError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::FrameTooLarge { size, max } => {
                write!(formatter, "frame size {size} exceeds maxFrameBytes {max}")
            }
            Self::TruncatedLength { read } => {
                write!(
                    formatter,
                    "frame length prefix truncated after {read} bytes"
                )
            }
            Self::TruncatedFrame { expected, read } => {
                write!(
                    formatter,
                    "frame body truncated after {read} of {expected} bytes"
                )
            }
            Self::Io(error) => write!(formatter, "frame I/O failed: {error}"),
        }
    }
}

impl Error for FrameError {
    fn source(&self) -> Option<&(dyn Error + 'static)> {
        match self {
            Self::Io(error) => Some(error),
            Self::FrameTooLarge { .. }
            | Self::TruncatedLength { .. }
            | Self::TruncatedFrame { .. } => None,
        }
    }
}

impl From<io::Error> for FrameError {
    fn from(error: io::Error) -> Self {
        Self::Io(error)
    }
}

pub(crate) struct FrameReader<R> {
    reader: R,
    max_frame_bytes: usize,
}

impl<R> FrameReader<R> {
    pub(crate) fn new(reader: R) -> Self {
        Self::with_max_frame_bytes(reader, MAX_FRAME_BYTES)
    }

    pub(crate) fn with_max_frame_bytes(reader: R, max_frame_bytes: usize) -> Self {
        Self {
            reader,
            max_frame_bytes,
        }
    }
}

impl<R> FrameReader<R>
where
    R: Read,
{
    pub(crate) fn recv(&mut self) -> Result<Option<Vec<u8>>, FrameError> {
        let mut prefix = [0_u8; 4];
        let prefix_read = read_until_full_or_eof(&mut self.reader, &mut prefix)?;

        if prefix_read == 0 {
            return Ok(None);
        }

        if prefix_read != prefix.len() {
            return Err(FrameError::TruncatedLength { read: prefix_read });
        }

        let frame_len = u32::from_be_bytes(prefix) as usize;
        if frame_len > self.max_frame_bytes {
            return Err(FrameError::FrameTooLarge {
                size: frame_len,
                max: self.max_frame_bytes,
            });
        }

        let mut frame = vec![0_u8; frame_len];
        let body_read = read_until_full_or_eof(&mut self.reader, &mut frame)?;

        if body_read != frame_len {
            return Err(FrameError::TruncatedFrame {
                expected: frame_len,
                read: body_read,
            });
        }

        Ok(Some(frame))
    }
}

pub(crate) struct FrameWriter<W> {
    writer: W,
    max_frame_bytes: usize,
}

impl<W> FrameWriter<W> {
    pub(crate) fn new(writer: W) -> Self {
        Self::with_max_frame_bytes(writer, MAX_FRAME_BYTES)
    }

    pub(crate) fn with_max_frame_bytes(writer: W, max_frame_bytes: usize) -> Self {
        Self {
            writer,
            max_frame_bytes,
        }
    }
}

impl<W> FrameWriter<W>
where
    W: Write,
{
    pub(crate) fn send(&mut self, payload: &[u8]) -> Result<(), FrameError> {
        if payload.len() > self.max_frame_bytes {
            return Err(FrameError::FrameTooLarge {
                size: payload.len(),
                max: self.max_frame_bytes,
            });
        }

        let frame_len = u32::try_from(payload.len()).map_err(|_| FrameError::FrameTooLarge {
            size: payload.len(),
            max: self.max_frame_bytes,
        })?;

        self.writer.write_all(&frame_len.to_be_bytes())?;
        self.writer.write_all(payload)?;
        self.writer.flush()?;

        Ok(())
    }
}

fn read_until_full_or_eof<R>(reader: &mut R, buffer: &mut [u8]) -> io::Result<usize>
where
    R: Read,
{
    let mut read = 0;

    while read < buffer.len() {
        match reader.read(&mut buffer[read..]) {
            Ok(0) => break,
            Ok(count) => read += count,
            Err(error) if error.kind() == io::ErrorKind::Interrupted => {}
            Err(error) => return Err(error),
        }
    }

    Ok(read)
}

#[cfg(test)]
mod tests {
    use super::{FrameError, FrameReader, FrameWriter, MAX_FRAME_BYTES};
    use std::{
        io::{Cursor, Read},
        process::{Command, Stdio},
    };

    #[test]
    fn writer_emits_big_endian_length_prefix() {
        let mut output = Vec::new();
        let mut writer = FrameWriter::new(&mut output);

        writer.send(b"hi").expect("frame should write");

        assert_eq!(output, [0, 0, 0, 2, b'h', b'i']);
    }

    #[test]
    fn reader_decodes_concatenated_frames() {
        let bytes = [
            0, 0, 0, 2, b'o', b'k', 0, 0, 0, 5, b'h', b'e', b'l', b'l', b'o',
        ];
        let mut reader = FrameReader::new(Cursor::new(bytes));

        assert_eq!(
            reader.recv().expect("first frame should decode"),
            Some(b"ok".to_vec())
        );
        assert_eq!(
            reader.recv().expect("second frame should decode"),
            Some(b"hello".to_vec())
        );
        assert_eq!(reader.recv().expect("clean eof should decode"), None);
    }

    #[test]
    fn reader_decodes_partial_reads() {
        let bytes = [0, 0, 0, 5, b'h', b'e', b'l', b'l', b'o'];
        let mut reader = FrameReader::new(ChunkedRead::new(&bytes, 2));

        assert_eq!(
            reader.recv().expect("partial frame should decode"),
            Some(b"hello".to_vec())
        );
    }

    #[test]
    fn clean_eof_before_length_returns_none() {
        let mut reader = FrameReader::new(Cursor::new([]));

        assert_eq!(reader.recv().expect("clean eof should decode"), None);
    }

    #[test]
    fn truncated_length_is_an_error() {
        let mut reader = FrameReader::new(Cursor::new([0, 0]));

        let error = reader.recv().expect_err("truncated length should fail");

        assert!(matches!(error, FrameError::TruncatedLength { read: 2 }));
    }

    #[test]
    fn truncated_body_is_an_error() {
        let mut reader = FrameReader::new(Cursor::new([0, 0, 0, 4, b'o', b'k']));

        let error = reader.recv().expect_err("truncated body should fail");

        assert!(matches!(
            error,
            FrameError::TruncatedFrame {
                expected: 4,
                read: 2
            }
        ));
    }

    #[test]
    fn oversized_length_is_rejected_before_body_read() {
        let oversized = (MAX_FRAME_BYTES as u32 + 1).to_be_bytes();
        let mut reader = FrameReader::new(PanicAfterPrefix::new(oversized));

        let error = reader.recv().expect_err("oversized frame should fail");

        assert!(matches!(
            error,
            FrameError::FrameTooLarge {
                size,
                max: MAX_FRAME_BYTES
            } if size == MAX_FRAME_BYTES + 1
        ));
    }

    #[test]
    fn writer_rejects_oversized_payload() {
        let mut output = Vec::new();
        let mut writer = FrameWriter::with_max_frame_bytes(&mut output, 2);

        let error = writer
            .send(b"hey")
            .expect_err("oversized payload should fail");

        assert!(matches!(
            error,
            FrameError::FrameTooLarge { size: 3, max: 2 }
        ));
        assert!(output.is_empty(), "oversized payload must write nothing");
    }

    #[test]
    fn child_stdio_round_trips_a_frame() {
        let mut child = Command::new("bun")
            .args([
                "-e",
                "const fs = require('node:fs'); const input = fs.readFileSync(0); fs.writeFileSync(1, input);",
            ])
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .spawn()
            .expect("bun child should spawn");

        {
            let stdin = child.stdin.take().expect("child stdin should be piped");
            let mut writer = FrameWriter::new(stdin);
            writer.send(b"hello pipe").expect("frame should send");
        }

        let stdout = child.stdout.take().expect("child stdout should be piped");
        let mut reader = FrameReader::new(stdout);
        let frame = reader.recv().expect("frame should decode");

        assert_eq!(frame, Some(b"hello pipe".to_vec()));

        let mut stderr = String::new();
        if let Some(mut child_stderr) = child.stderr.take() {
            child_stderr
                .read_to_string(&mut stderr)
                .expect("child stderr should read");
        }
        let status = child.wait().expect("child should exit");

        assert!(status.success(), "child failed: {status}; stderr: {stderr}");
    }

    struct ChunkedRead<'a> {
        cursor: Cursor<&'a [u8]>,
        chunk_size: usize,
    }

    impl<'a> ChunkedRead<'a> {
        fn new(bytes: &'a [u8], chunk_size: usize) -> Self {
            Self {
                cursor: Cursor::new(bytes),
                chunk_size,
            }
        }
    }

    impl Read for ChunkedRead<'_> {
        fn read(&mut self, buffer: &mut [u8]) -> std::io::Result<usize> {
            let limit = self.chunk_size.min(buffer.len());
            self.cursor.read(&mut buffer[..limit])
        }
    }

    struct PanicAfterPrefix {
        prefix: Cursor<[u8; 4]>,
    }

    impl PanicAfterPrefix {
        fn new(prefix: [u8; 4]) -> Self {
            Self {
                prefix: Cursor::new(prefix),
            }
        }
    }

    impl Read for PanicAfterPrefix {
        fn read(&mut self, buffer: &mut [u8]) -> std::io::Result<usize> {
            let read = self.prefix.read(buffer)?;
            if read == 0 {
                panic!("reader attempted to read an oversized frame body");
            }

            Ok(read)
        }
    }
}
