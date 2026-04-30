import React from 'react';
import ReactMarkdown from 'react-markdown';

export default function Markdown({ children }) {
  return (
    <div className="markdown-body">
      <ReactMarkdown>{children}</ReactMarkdown>
    </div>
  );
}
