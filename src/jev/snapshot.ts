import type { Page } from '@playwright/test';

export interface Control {
  index: number;
  role: string;
  name: string;
  text: string;
  tag: string;
  type?: string;
}

export interface PageSnapshot {
  url: string;
  title: string;
  visibleText: string;
  controls: Control[];
  summary: string;
}

/**
 * Build a compact, text-based state from the current page for Jev.
 * Jev never sees pixels or invents selectors — only what code extracts.
 */
export async function snapshotPage(page: Page): Promise<PageSnapshot> {
  const url = page.url();
  const title = await page.title();

  // Visible text (truncated for cost)
  const visibleText = await page.evaluate(() => {
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    const texts: string[] = [];
    let node: Node | null;
    while ((node = walker.nextNode())) {
      const t = node.textContent?.trim();
      if (t && t.length > 1) texts.push(t);
    }
    return texts.join(' ').slice(0, 4000);
  });

  // Interactive controls with stable indices
  const controls = await page.evaluate(() => {
    const selectors = 'a, button, input, select, textarea, [role="button"], [role="link"], [role="menuitem"], [onclick]';
    const els = Array.from(document.querySelectorAll(selectors));
    return els
      .filter((el) => {
        const style = window.getComputedStyle(el);
        return style.display !== 'none' && style.visibility !== 'hidden' && (el as HTMLElement).offsetParent !== null;
      })
      .slice(0, 40) // cap for cost/speed
      .map((el, index) => {
        const tag = el.tagName.toLowerCase();
        const role = el.getAttribute('role') || tag;
        const name =
          el.getAttribute('aria-label') ||
          el.getAttribute('name') ||
          el.getAttribute('placeholder') ||
          el.getAttribute('title') ||
          (el as HTMLElement).innerText?.trim().slice(0, 80) ||
          '';
        const text = (el as HTMLElement).innerText?.trim().slice(0, 120) || '';
        const type = (el as HTMLInputElement).type || undefined;
        return { index, role, name, text, tag, type };
      });
  });

  const summary = [
    `URL: ${url}`,
    `Title: ${title}`,
    `Visible text excerpt: ${visibleText.slice(0, 1500)}`,
    `Controls (${controls.length}):`,
    ...controls.map((c) => `[${c.index}] ${c.role}/${c.tag} "${c.name || c.text}"${c.type ? ` type=${c.type}` : ''}`),
  ].join('\n');

  return { url, title, visibleText, controls, summary };
}
