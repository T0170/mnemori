import React from 'react';
import ReactMarkdown, { defaultUrlTransform } from 'react-markdown';
import { useToast } from '../lib/toast';

function urlTransform(url) {
  if (url.startsWith('media://')) return url;
  return defaultUrlTransform(url);
}

function ScreenshotImg({ src, alt, screenshots, toast }) {
  const ss = screenshots.find(s => src.includes(s.file_path.replace(/\\/g, '/')));
  if (!ss) return <img src={src} alt={alt} />;

  async function copy(e) {
    e.stopPropagation();
    const result = await window.api.system.copyScreenshot(ss.file_path);
    if (result.ok) toast('Screenshot copied');
  }

  async function save(e) {
    e.stopPropagation();
    const result = await window.api.system.saveScreenshot(ss.file_path);
    if (result.ok) toast('Screenshot saved');
  }

  return (
    <span className="artifact-screenshot">
      <img src={src} alt={alt} />
      <span className="screenshot-actions">
        <button className="btn btn-ghost btn-sm" onClick={copy}>Copy</button>
        <button className="btn btn-ghost btn-sm" onClick={save}>Save</button>
      </span>
    </span>
  );
}

export default function Markdown({ children, screenshots }) {
  const toast = useToast();

  const components = screenshots?.length > 0 ? {
    img: ({ src, alt }) => {
      if (src?.startsWith('media://')) {
        return <ScreenshotImg src={src} alt={alt} screenshots={screenshots} toast={toast} />;
      }
      return <img src={src} alt={alt} />;
    },
  } : undefined;

  return (
    <div className="markdown-body">
      <ReactMarkdown
        urlTransform={urlTransform}
        components={components}
        disallowedElements={['script', 'iframe', 'object', 'embed']}
        unwrapDisallowed
      >
        {children}
      </ReactMarkdown>
    </div>
  );
}
