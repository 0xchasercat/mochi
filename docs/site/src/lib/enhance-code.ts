/**
 * Client-side enhancement: chrome every markdown-rendered <pre> block with
 * a header bar (language label + copy-to-clipboard button), matching the
 * brand's hand-coded `.d-code` aesthetic from docs.css.
 *
 * Why client-side and not a Rehype plugin: Astro's markdown pipeline emits
 * Shiki output in a stable shape; wrapping it server-side would require a
 * custom transformer that knows the exact AST. Client-side enhancement is
 * dependency-free, idempotent (re-runnable), and keeps the build path
 * vanilla `markdown.shikiConfig`.
 *
 * Idempotent: re-runs are safe (already-wrapped <pre> elements skipped).
 * Imported with side-effects from DocsLayout.astro's <script> block.
 */

(function enhanceCodeBlocks() {
  const pres = document.querySelectorAll<HTMLPreElement>(".d-prose pre");
  for (const pre of Array.from(pres)) {
    if (pre.parentElement?.classList.contains("d-md-code")) continue;

    // Detect language. Shiki emits <pre><code class="language-XX"> in some
    // configurations and <pre data-language="XX"> in others. Cover both.
    const codeEl = pre.querySelector<HTMLElement>("code");
    let lang = "";
    const langCls = codeEl?.className.match(/language-(\S+)/);
    if (langCls) lang = langCls[1];
    else if (pre.dataset.language) lang = pre.dataset.language;

    const wrap = document.createElement("figure");
    wrap.className = "d-md-code";

    const bar = document.createElement("div");
    bar.className = "d-md-code-bar";

    const langSpan = document.createElement("span");
    langSpan.className = "d-md-code-lang";
    langSpan.textContent = lang;
    bar.appendChild(langSpan);

    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "d-md-code-copy";
    btn.setAttribute("aria-label", "Copy code to clipboard");
    // Inline SVG so the button works without a separate icon font request.
    btn.innerHTML = [
      '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" ',
      'stroke="currentColor" stroke-width="2" stroke-linecap="round" ',
      'stroke-linejoin="round" aria-hidden="true">',
      '<rect x="9" y="9" width="13" height="13" rx="2" ry="2"/>',
      '<path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>',
      "</svg><span>Copy</span>",
    ].join("");

    btn.addEventListener("click", async () => {
      const span = btn.querySelector("span");
      try {
        // `innerText` strips the syntax-highlighting span structure but
        // keeps line breaks correctly; `textContent` would also work but
        // can sometimes coalesce whitespace in some browsers.
        await navigator.clipboard.writeText(pre.innerText);
        btn.classList.add("is-copied");
        if (span) span.textContent = "Copied";
        // ARIA live announcement so screen-reader users know it worked.
        btn.setAttribute("aria-label", "Copied to clipboard");
        setTimeout(() => {
          btn.classList.remove("is-copied");
          if (span) span.textContent = "Copy";
          btn.setAttribute("aria-label", "Copy code to clipboard");
        }, 1500);
      } catch (_err) {
        if (span) span.textContent = "Failed";
        setTimeout(() => {
          if (span) span.textContent = "Copy";
        }, 1500);
      }
    });

    bar.appendChild(btn);

    pre.parentNode?.insertBefore(wrap, pre);
    wrap.appendChild(bar);
    wrap.appendChild(pre);
  }
})();
