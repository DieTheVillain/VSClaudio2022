import { useRef, useState, type ComponentProps } from 'react';
import ReactMarkdown from 'react-markdown';
import rehypeHighlight from 'rehype-highlight';
import remarkGfm from 'remark-gfm';

// No rehype-raw: HTML in model output must render as text, never as markup.
export function Markdown({ text }: { text: string }) {
  return (
    <div className="md">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        rehypePlugins={[rehypeHighlight]}
        components={{
          pre: CodeBlock,
          a: ({ node: _node, ...props }) => <a {...props} target="_blank" rel="noreferrer" />,
          img: ImageLink,
        }}
      >
        {text}
      </ReactMarkdown>
    </div>
  );
}

// Images load on render, so a prompt-injected image URL could leak data. Show a link instead.
function ImageLink({ node: _node, src, alt }: ComponentProps<'img'> & { node?: unknown }) {
  const url = typeof src === 'string' ? src : '';
  if (!/^https?:\/\//i.test(url)) return <>{alt}</>;
  return <a href={url} target="_blank" rel="noreferrer">{alt || url}</a>;
}

function CodeBlock({ node: _node, children, ...rest }: ComponentProps<'pre'> & { node?: unknown }) {
  const ref = useRef<HTMLPreElement>(null);
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    await navigator.clipboard?.writeText(ref.current?.innerText ?? '');
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };
  return (
    <div className="code-block">
      <button className="copy" onClick={copy} aria-label="Copy code">{copied ? 'Copied' : 'Copy'}</button>
      <pre ref={ref} {...rest}>{children}</pre>
    </div>
  );
}
