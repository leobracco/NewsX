// Nav mobile toggle
function toggleMenu() {
  document.getElementById("navMobile").classList.toggle("open");
}

// Cerrar menu al hacer click fuera
document.addEventListener("click", (e) => {
  const menu   = document.getElementById("navMobile");
  const burger = document.querySelector(".nav-burger");
  if (menu && !menu.contains(e.target) && !burger.contains(e.target)) {
    menu.classList.remove("open");
  }
});

// Fade-in cards al cargar
document.addEventListener("DOMContentLoaded", () => {
  const cards = document.querySelectorAll(".news-card");
  cards.forEach((card, i) => {
    card.style.opacity = "0";
    card.style.transform = "translateY(16px)";
    card.style.transition = `opacity .4s ease ${i * 0.06}s, transform .4s ease ${i * 0.06}s`;
    setTimeout(() => {
      card.style.opacity = "1";
      card.style.transform = "translateY(0)";
    }, 50);
  });
});
