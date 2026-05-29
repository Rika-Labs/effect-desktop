import { expect, test } from "bun:test"

import { stableEndpointInputDependency } from "./endpoints.js"

test("stableEndpointInputDependency distinguishes Map inputs that JSON.stringify collapses to {}", () => {
  expect(stableEndpointInputDependency(new Map([["a", 1]]))).not.toBe(
    stableEndpointInputDependency(new Map([["b", 2]]))
  )
})

test("stableEndpointInputDependency distinguishes Set inputs", () => {
  expect(stableEndpointInputDependency(new Set([1, 2]))).not.toBe(
    stableEndpointInputDependency(new Set([3, 4]))
  )
})

test("stableEndpointInputDependency is stable for equal plain inputs and distinct for different ones", () => {
  expect(stableEndpointInputDependency({ id: "a" })).toBe(
    stableEndpointInputDependency({ id: "a" })
  )
  expect(stableEndpointInputDependency({ id: "a" })).not.toBe(
    stableEndpointInputDependency({ id: "b" })
  )
})

test("stableEndpointInputDependency encodes nested bigint without throwing", () => {
  expect(stableEndpointInputDependency({ id: 1n })).toBe(stableEndpointInputDependency({ id: 1n }))
  expect(stableEndpointInputDependency({ id: 1n })).not.toBe(
    stableEndpointInputDependency({ id: 2n })
  )
})

test("stableEndpointInputDependency returns a stable constant for unkeyable circular inputs", () => {
  const circular: Record<string, unknown> = {}
  circular["self"] = circular
  const other: Record<string, unknown> = {}
  other["self"] = other
  expect(stableEndpointInputDependency(circular)).toBe(stableEndpointInputDependency(other))
})
