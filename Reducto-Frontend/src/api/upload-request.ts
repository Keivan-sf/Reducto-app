/** XHR exposes actual network upload progress on both React Native and web. */
export function uploadRequest(
  url: string,
  options: RequestInit,
  progress: (sent: number, total: number) => void,
): Promise<Response> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    const signal = options.signal;
    const cleanup = () => signal?.removeEventListener('abort', abort);
    const abort = () => {
      xhr.abort();
      cleanup();
      reject(new DOMException('Upload cancelled.', 'AbortError'));
    };
    if (signal?.aborted) return abort();
    xhr.open('POST', url);
    new Headers(options.headers).forEach((value, key) => xhr.setRequestHeader(key, value));
    xhr.upload.onprogress = (event) =>
      progress(event.loaded, event.lengthComputable ? event.total : 0);
    xhr.onload = () => {
      cleanup();
      resolve(new Response(xhr.responseText, { status: xhr.status }));
    };
    xhr.onerror = () => {
      cleanup();
      reject(new Error('Upload failed. Check your connection.'));
    };
    xhr.onabort = () => {
      cleanup();
      reject(new DOMException('Upload cancelled.', 'AbortError'));
    };
    signal?.addEventListener('abort', abort, { once: true });
    xhr.send(options.body as FormData);
  });
}
