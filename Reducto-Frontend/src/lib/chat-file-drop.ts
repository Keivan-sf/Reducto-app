/** Bind only to the active web chat; file bytes are available on drop. */
export function bindChatFileDrop(
  element: HTMLElement,
  onHover: (mimeType: string | null) => void,
  onFile: (file: File) => void,
) {
  let depth = 0;
  const reset = () => {
    depth = 0;
    onHover(null);
  };
  const hasFiles = (event: DragEvent) =>
    Array.from(event.dataTransfer?.types ?? []).includes('Files');
  const hover = (event: DragEvent) => {
    if (!hasFiles(event)) return;
    event.preventDefault();
    if (event.dataTransfer) event.dataTransfer.dropEffect = 'copy';
    onHover(event.dataTransfer?.items[0]?.type ?? '');
  };
  const enter = (event: DragEvent) => {
    if (!hasFiles(event)) return;
    depth++;
    hover(event);
  };
  const leave = (event: DragEvent) => {
    if (!hasFiles(event)) return;
    if (--depth <= 0) reset();
  };
  const drop = (event: DragEvent) => {
    if (!hasFiles(event)) return;
    event.preventDefault();
    reset();
    const file = event.dataTransfer?.files[0];
    if (file) onFile(file);
  };
  const window = element.ownerDocument.defaultView!;
  element.addEventListener('dragenter', enter);
  element.addEventListener('dragover', hover);
  element.addEventListener('dragleave', leave);
  element.addEventListener('drop', drop);
  window.addEventListener('drop', reset);
  window.addEventListener('dragend', reset);
  window.addEventListener('blur', reset);
  return () => {
    element.removeEventListener('dragenter', enter);
    element.removeEventListener('dragover', hover);
    element.removeEventListener('dragleave', leave);
    element.removeEventListener('drop', drop);
    window.removeEventListener('drop', reset);
    window.removeEventListener('dragend', reset);
    window.removeEventListener('blur', reset);
    reset();
  };
}
