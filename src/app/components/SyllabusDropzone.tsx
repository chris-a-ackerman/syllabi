import { useRef, useState } from 'react';
import { Button } from './ui/button';
import { Upload, CheckCircle, X } from 'lucide-react';

interface SyllabusDropzoneProps {
  /** Receives every PDF dropped or browsed — one file unless `multiple`. Non-PDFs are ignored. */
  onFiles: (files: File[]) => void;
  /** Accept several files per drop/browse (the bulk flows). */
  multiple?: boolean;
  /** Single-file flows: show this file inside the zone with a clear button instead of the prompt. */
  selectedFile?: File | null;
  onClear?: () => void;
  title?: string;
  hint?: string;
  /** 'page' is the larger full-page styling (Onboarding, single upload); default is the modal scale. */
  variant?: 'compact' | 'page';
}

const isPdf = (file: File) =>
  file.type === 'application/pdf' || file.name.toLowerCase().endsWith('.pdf');

/**
 * The one PDF drag-and-drop picker (SYL-39; SYL-68: previously also three
 * hand-rolled `dataset.dragging` copies in BulkUploadModal, AddSemesterModal
 * and Onboarding). The whole zone is clickable to browse.
 */
export function SyllabusDropzone({
  onFiles,
  multiple = false,
  selectedFile = null,
  onClear,
  title = 'Drop PDF syllabi here',
  hint = 'or click to browse',
  variant = 'compact',
}: SyllabusDropzoneProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragActive, setDragActive] = useState(false);
  const [rejected, setRejected] = useState(false);
  const page = variant === 'page';

  const accept = (list: FileList | null) => {
    const offered = Array.from(list ?? []);
    const pdfs = offered.filter(isPdf);
    setRejected(offered.length > 0 && pdfs.length === 0);
    if (pdfs.length > 0) onFiles(multiple ? pdfs : pdfs.slice(0, 1));
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    setDragActive(true);
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setDragActive(false);
    accept(e.dataTransfer.files);
  };

  return (
    <div
      onDragEnter={handleDragOver}
      onDragOver={handleDragOver}
      onDragLeave={() => setDragActive(false)}
      onDrop={handleDrop}
      onClick={selectedFile ? undefined : () => inputRef.current?.click()}
      className={`border-2 border-dashed text-center transition-colors ${
        page ? 'rounded-2xl p-12' : 'rounded-xl p-8'
      } ${selectedFile ? '' : 'cursor-pointer'} ${
        dragActive
          ? 'border-indigo-500 bg-indigo-50'
          : 'border-gray-300 hover:border-indigo-400 bg-white'
      }`}
    >
      {selectedFile ? (
        <div className="flex items-center justify-between bg-gray-50 rounded-lg p-4">
          <div className="flex items-center gap-3 min-w-0">
            <CheckCircle className="w-5 h-5 text-green-600 shrink-0" />
            <div className="text-left min-w-0">
              <p className="text-sm font-medium text-gray-900 truncate">{selectedFile.name}</p>
              <p className="text-xs text-gray-500">{(selectedFile.size / 1024).toFixed(1)} KB</p>
            </div>
          </div>
          <Button variant="ghost" size="sm" onClick={onClear} className="rounded-lg shrink-0">
            <X className="w-4 h-4" />
          </Button>
        </div>
      ) : (
        <>
          <Upload className={`text-gray-400 mx-auto ${page ? 'w-10 h-10 mb-4' : 'w-8 h-8 mb-3'}`} />
          <p className={`font-medium text-gray-700 mb-1 ${page ? 'text-lg' : 'text-sm'}`}>
            {title}
          </p>
          <p className={`text-gray-500 ${page ? 'text-sm' : 'text-xs'}`}>{hint}</p>
          {rejected && <p className="text-xs text-red-600 mt-2">Only PDF files are supported.</p>}
        </>
      )}
      <input
        ref={inputRef}
        type="file"
        accept=".pdf,application/pdf"
        multiple={multiple}
        className="hidden"
        onChange={(e) => {
          accept(e.target.files);
          e.target.value = '';
        }}
      />
    </div>
  );
}
