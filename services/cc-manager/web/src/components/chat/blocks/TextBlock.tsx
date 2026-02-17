import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { CodeBlock } from "./CodeBlock";

interface TextBlockProps {
  text: string;
  isStreaming?: boolean;
}

export function TextBlock({ text, isStreaming }: TextBlockProps) {
  if (!text) {
    return isStreaming ? <StreamingCursor /> : null;
  }

  return (
    <div className="prose-chat">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          code({ className, children, ...props }) {
            const match = /language-(\w+)/.exec(className || "");
            const text = String(children).replace(/\n$/, "");

            if (match) {
              return <CodeBlock language={match[1]}>{text}</CodeBlock>;
            }

            // Check if it's a fenced block (multi-line or has className)
            const isBlock = className || String(children).includes("\n");
            if (isBlock) {
              return <CodeBlock>{text}</CodeBlock>;
            }

            return (
              <code
                className="bg-muted px-1 py-0.5 rounded font-mono text-xs"
                {...props}
              >
                {children}
              </code>
            );
          },
          pre({ children }) {
            // Unwrap pre since CodeBlock handles its own wrapper
            return <>{children}</>;
          },
          p({ children }) {
            return <p className="my-1.5 first:mt-0 last:mb-0">{children}</p>;
          },
          ul({ children }) {
            return <ul className="my-1.5 ml-4 list-disc space-y-0.5">{children}</ul>;
          },
          ol({ children }) {
            return <ol className="my-1.5 ml-4 list-decimal space-y-0.5">{children}</ol>;
          },
          li({ children }) {
            return <li className="pl-0.5">{children}</li>;
          },
          h1({ children }) {
            return <h1 className="text-lg font-semibold mt-3 mb-1.5 first:mt-0">{children}</h1>;
          },
          h2({ children }) {
            return <h2 className="text-base font-semibold mt-3 mb-1.5 first:mt-0">{children}</h2>;
          },
          h3({ children }) {
            return <h3 className="text-sm font-semibold mt-2 mb-1 first:mt-0">{children}</h3>;
          },
          blockquote({ children }) {
            return (
              <blockquote className="border-l-2 border-muted-foreground/30 pl-3 my-1.5 text-muted-foreground italic">
                {children}
              </blockquote>
            );
          },
          a({ href, children }) {
            return (
              <a
                href={href}
                target="_blank"
                rel="noopener noreferrer"
                className="text-primary underline underline-offset-2"
              >
                {children}
              </a>
            );
          },
          table({ children }) {
            return (
              <div className="my-2 overflow-x-auto">
                <table className="min-w-full text-xs border border-border rounded">
                  {children}
                </table>
              </div>
            );
          },
          th({ children }) {
            return (
              <th className="px-2 py-1 text-left font-medium bg-muted border-b border-border">
                {children}
              </th>
            );
          },
          td({ children }) {
            return (
              <td className="px-2 py-1 border-b border-border">{children}</td>
            );
          },
          hr() {
            return <hr className="my-3 border-border" />;
          },
        }}
      >
        {text}
      </ReactMarkdown>
      {isStreaming && <StreamingCursor />}
    </div>
  );
}

function StreamingCursor() {
  return (
    <span
      className="inline-block w-0.5 h-4 bg-foreground align-text-bottom ml-0.5"
      style={{ animation: "cursor-blink 1s step-end infinite" }}
    />
  );
}
