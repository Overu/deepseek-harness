/**
 * Markdown 与 HTML 双向转换，支持 H1~H3、加粗、斜体、删除线、行内代码、代码块、引用、列表、分割线和正文段落。
 * 没有引入 @tiptap/markdown，是因为这里的需求相对简单，自定义更灵活。
 */

/**
 * 将 Markdown 字符串解析为语义化 HTML 字符串
 */
export function markdownToHtml(markdown: string): string {
  if (!markdown) return '';

  // 统一换行符
  const rawLines = markdown.replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n');

  const htmlChunks: string[] = [];
  let inUl = false;
  let inOl = false;
  let inCodeBlock = false;
  let paragraphLines: string[] = [];
  let quoteLines: string[] = [];
  let codeLines: string[] = [];

  const closeListIfOpen = () => {
    if (inUl) {
      htmlChunks.push('</ul>');
      inUl = false;
    }
    if (inOl) {
      htmlChunks.push('</ol>');
      inOl = false;
    }
  };

  const flushParagraph = () => {
    if (!paragraphLines.length) return;
    htmlChunks.push(`<p>${paragraphLines.map(formatInline).join('<br />')}</p>`);
    paragraphLines = [];
  };

  const flushQuote = () => {
    if (!quoteLines.length) return;
    htmlChunks.push(`<blockquote><p>${quoteLines.map(formatInline).join('<br />')}</p></blockquote>`);
    quoteLines = [];
  };

  const flushCodeBlock = () => {
    htmlChunks.push(`<pre><code>${escapeHtml(codeLines.join('\n'))}</code></pre>`);
    codeLines = [];
  };

  for (let i = 0; i < rawLines.length; i++) {
    const line = rawLines[i];
    const trimmed = line.trim();

    if (inCodeBlock) {
      if (/^```\s*$/.test(trimmed)) {
        flushCodeBlock();
        inCodeBlock = false;
      } else {
        codeLines.push(line);
      }
      continue;
    }

    if (/^```(?:[\w-]+)?\s*$/.test(trimmed)) {
      flushParagraph();
      flushQuote();
      closeListIfOpen();
      inCodeBlock = true;
      continue;
    }

    // 空行
    if (!trimmed) {
      flushParagraph();
      flushQuote();
      closeListIfOpen();
      continue;
    }

    // 分割线 (--- 或 *** 或 ___)
    if (/^(\*{3,}|-{3,}|_{3,})$/.test(trimmed)) {
      flushParagraph();
      flushQuote();
      closeListIfOpen();
      htmlChunks.push('<hr />');
      continue;
    }

    // H1 标题
    if (/^#\s+(.*)$/.test(trimmed)) {
      flushParagraph();
      flushQuote();
      closeListIfOpen();
      const content = trimmed.replace(/^#\s+/, '');
      htmlChunks.push(`<h1>${formatInline(content)}</h1>`);
      continue;
    }

    // H2 标题
    if (/^##\s+(.*)$/.test(trimmed)) {
      flushParagraph();
      flushQuote();
      closeListIfOpen();
      const content = trimmed.replace(/^##\s+/, '');
      htmlChunks.push(`<h2>${formatInline(content)}</h2>`);
      continue;
    }

    // H3 标题
    if (/^###\s+(.*)$/.test(trimmed)) {
      flushParagraph();
      flushQuote();
      closeListIfOpen();
      const content = trimmed.replace(/^###\s+/, '');
      htmlChunks.push(`<h3>${formatInline(content)}</h3>`);
      continue;
    }

    // 无序列表 (- item 或 * item 或 + item)
    const ulMatch = trimmed.match(/^[-*+]\s+(.*)$/);
    if (ulMatch) {
      flushParagraph();
      flushQuote();
      if (inOl) {
        htmlChunks.push('</ol>');
        inOl = false;
      }
      if (!inUl) {
        htmlChunks.push('<ul>');
        inUl = true;
      }
      htmlChunks.push(`<li><p>${formatInline(ulMatch[1])}</p></li>`);
      continue;
    }

    // 有序列表 (1. item 或 2. item)
    const olMatch = trimmed.match(/^(\d+)\.\s+(.*)$/);
    if (olMatch) {
      flushParagraph();
      flushQuote();
      if (inUl) {
        htmlChunks.push('</ul>');
        inUl = false;
      }
      if (!inOl) {
        htmlChunks.push('<ol>');
        inOl = true;
      }
      htmlChunks.push(`<li><p>${formatInline(olMatch[2])}</p></li>`);
      continue;
    }

    const quoteMatch = line.match(/^\s*>\s?(.*)$/);
    if (quoteMatch) {
      flushParagraph();
      closeListIfOpen();
      quoteLines.push(quoteMatch[1]);
      continue;
    }

    // 连续普通行属于同一段落，以软换行保留原始多行文本
    flushQuote();
    closeListIfOpen();
    paragraphLines.push(line);
  }

  if (inCodeBlock) flushCodeBlock();
  flushParagraph();
  flushQuote();
  closeListIfOpen();

  return htmlChunks.join('');
}

/**
 * 格式化行内元素（加粗、斜体）
 */
function formatInline(text: string): string {
  if (!text) return '';

  const inlineCode: string[] = [];
  let formatted = escapeHtml(text).replace(/`([^`]+)`/g, (_, content: string) => {
    const index = inlineCode.push(`<code>${content}</code>`) - 1;
    return `<codex-inline-code data-index="${index}"></codex-inline-code>`;
  });

  // 删除线 (~~text~~)
  formatted = formatted.replace(/~~(.*?)~~/g, '<s>$1</s>');

  // 加粗+斜体 (***text*** 或 ___text___)
  formatted = formatted.replace(/(\*\*\*|___)(.*?)\1/g, '<strong><em>$2</em></strong>');

  // 加粗 (**text** 或 __text__)
  formatted = formatted.replace(/(\*\*|__)(.*?)\1/g, '<strong>$2</strong>');

  // 斜体 (*text* 或 _text_)
  formatted = formatted.replace(/(\*|_)(.*?)\1/g, '<em>$2</em>');

  return formatted.replace(/<codex-inline-code data-index="(\d+)"><\/codex-inline-code>/g, (_, index: string) => inlineCode[Number(index)]);
}

function escapeHtml(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/**
 * 将 HTML 字符串转换为 Markdown 字符串
 */
export function htmlToMarkdown(html: string): string {
  if (!html) return '';

  // 在浏览器环境中利用 DOMParser 解析
  if (typeof DOMParser !== 'undefined') {
    const parser = new DOMParser();
    const doc = parser.parseFromString(html, 'text/html');
    return nodeToMarkdown(doc.body).trim();
  }

  // 兜底基础转换
  return html
    .replace(/<h1>(.*?)<\/h1>/gi, '# $1\n\n')
    .replace(/<h2>(.*?)<\/h2>/gi, '## $1\n\n')
    .replace(/<h3>(.*?)<\/h3>/gi, '### $1\n\n')
    .replace(/<strong>(.*?)<\/strong>/gi, '**$1**')
    .replace(/<b>(.*?)<\/b>/gi, '**$1**')
    .replace(/<em>(.*?)<\/em>/gi, '*$1*')
    .replace(/<i>(.*?)<\/i>/gi, '*$1*')
    .replace(/<hr\s*\/?>/gi, '\n---\n\n')
    .replace(/<li><p>(.*?)<\/p><\/li>/gi, '- $1\n')
    .replace(/<li>(.*?)<\/li>/gi, '- $1\n')
    .replace(/<p>(.*?)<\/p>/gi, '$1\n\n')
    .replace(/<br\s*\/?>/gi, '\n')
    .trim();
}

/**
 * 递归将 DOM 节点转换为 Markdown
 */
function nodeToMarkdown(node: Node): string {
  let output = '';

  for (let i = 0; i < node.childNodes.length; i++) {
    const child = node.childNodes[i];

    if (child.nodeType === Node.TEXT_NODE) {
      output += child.textContent || '';
    } else if (child.nodeType === Node.ELEMENT_NODE) {
      const el = child as HTMLElement;
      const tagName = el.tagName.toLowerCase();

      switch (tagName) {
        case 'h1':
          output += `# ${nodeToMarkdown(el).trim()}\n\n`;
          break;
        case 'h2':
          output += `## ${nodeToMarkdown(el).trim()}\n\n`;
          break;
        case 'h3':
          output += `### ${nodeToMarkdown(el).trim()}\n\n`;
          break;
        case 'p': {
          const content = nodeToMarkdown(el);
          if (content.trim()) {
            output += `${content}\n\n`;
          }
          break;
        }
        case 'strong':
        case 'b':
          output += `**${nodeToMarkdown(el)}**`;
          break;
        case 'em':
        case 'i':
          output += `*${nodeToMarkdown(el)}*`;
          break;
        case 's':
        case 'del':
        case 'strike':
          output += `~~${nodeToMarkdown(el)}~~`;
          break;
        case 'code':
          output += `\`${nodeToMarkdown(el)}\``;
          break;
        case 'ul': {
          for (let j = 0; j < el.children.length; j++) {
            const li = el.children[j];
            output += `- ${nodeToMarkdown(li).trim()}\n`;
          }
          output += '\n';
          break;
        }
        case 'ol': {
          for (let j = 0; j < el.children.length; j++) {
            const li = el.children[j];
            output += `${j + 1}. ${nodeToMarkdown(li).trim()}\n`;
          }
          output += '\n';
          break;
        }
        case 'li':
          output += `- ${nodeToMarkdown(el).trim()}\n`;
          break;
        case 'h4':
        case 'h5':
        case 'h6':
          output += `### ${nodeToMarkdown(el).trim()}\n\n`;
          break;
        case 'blockquote':
          output += `${nodeToMarkdown(el)
            .trim()
            .split('\n')
            .map(line => `> ${line}`)
            .join('\n')}\n\n`;
          break;
        case 'a': {
          const href = el.getAttribute('href') || '';
          const text = nodeToMarkdown(el);
          output += href ? `[${text}](${href})` : text;
          break;
        }
        case 'pre':
          output += `\n\`\`\`\n${el.textContent || ''}\n\`\`\`\n\n`;
          break;
        case 'hr':
          output += '---\n\n';
          break;
        case 'br':
          output += '\n';
          break;
        default:
          output += nodeToMarkdown(el);
      }
    }
  }

  return output;
}

/**
 * 判断 HTML 是否包含语义化富文本标签（如 h1~h6, ul, ol, strong, em, hr, blockquote 等）
 */
export function hasSemanticHtml(html: string): boolean {
  if (!html) return false;
  return /<(h[1-6]|ul|ol|li|strong|b|em|i|del|s|strike|code|hr|blockquote|pre)\b/i.test(html);
}

/**
 * 判断文本是否包含 Markdown 语法特征
 */
export function isMarkdownText(text: string): boolean {
  if (!text) return false;
  return (
    /^#{1,6}\s+/m.test(text) || // 标题
    /\*\*([^*]+)\*\*/.test(text) || // 粗体
    /\*([^*]+)\*/.test(text) || // 斜体
    /~~([^~]+)~~/.test(text) || // 删除线
    /`([^`\n]+)`/.test(text) || // 行内代码
    /^\s*>\s+/m.test(text) || // 引用
    /^\s*```/m.test(text) || // 代码块
    /^\s*[-*+]\s+/m.test(text) || // 无序列表
    /^\s*\d+\.\s+/m.test(text) || // 有序列表
    /^\s*(\*{3,}|-{3,}|_{3,})\s*$/m.test(text) // 分割线
  );
}
