const status = document.querySelector("[data-render-status]");

if (status !== null) {
  status.textContent = "Playground renderer hydrated from app://localhost/";
}

document.documentElement.dataset.renderer = "hydrated";
