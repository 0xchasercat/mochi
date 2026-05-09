/**
 * Mobile drawer controller: hamburger button toggles `body[data-drawer-open]`,
 * which CSS uses to slide the .d-side sidebar into view + show a backdrop.
 *
 * Wired from DocsLayout.astro's <script> block. Side-effect-only module.
 *
 * Behavior:
 *   - click hamburger → open drawer (sets data attribute, locks body scroll)
 *   - click backdrop, click close button, press ESC → close drawer
 *   - clicking a sidebar link → close drawer (so the new page renders without
 *     the drawer covering it)
 *   - keep drawer state in sync with viewport: if window resizes back above
 *     900px, drop the data attribute to avoid leaving the drawer "open" in
 *     desktop layout (where it'd be invisible because CSS resets transform)
 */

(function wireMobileDrawer() {
  const body = document.body;
  const burger = document.querySelector<HTMLButtonElement>("[data-drawer-toggle]");
  const close = document.querySelector<HTMLButtonElement>("[data-drawer-close]");
  const backdrop = document.querySelector<HTMLElement>("[data-drawer-backdrop]");
  const sidebar = document.querySelector<HTMLElement>(".d-side");
  if (!burger || !sidebar) return;

  function open() {
    body.dataset.drawerOpen = "true";
    burger?.setAttribute("aria-expanded", "true");
    sidebar?.setAttribute("aria-hidden", "false");
  }
  function shut() {
    delete body.dataset.drawerOpen;
    burger?.setAttribute("aria-expanded", "false");
    sidebar?.setAttribute("aria-hidden", "true");
  }
  function toggle() {
    if (body.dataset.drawerOpen) shut();
    else open();
  }

  burger.addEventListener("click", toggle);
  close?.addEventListener("click", shut);
  backdrop?.addEventListener("click", shut);

  // Close on ESC, but only when the drawer is open — let other ESC handlers
  // (search modal, etc.) own their own close path otherwise.
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && body.dataset.drawerOpen) shut();
  });

  // Close when a sidebar link is clicked (we're navigating away).
  sidebar.querySelectorAll<HTMLAnchorElement>("a").forEach((a) => {
    a.addEventListener("click", () => shut());
  });

  // Resize sync — if the user rotates / resizes back to desktop, ensure
  // the body data attribute is cleared so subsequent re-opens behave.
  const mql = window.matchMedia("(min-width: 901px)");
  mql.addEventListener("change", (e) => {
    if (e.matches) shut();
  });

  // Initial a11y attrs.
  burger.setAttribute("aria-expanded", "false");
  sidebar.setAttribute("aria-hidden", "true");
})();
