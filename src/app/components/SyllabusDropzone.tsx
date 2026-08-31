import { useState } from 'react';
import { Button } from './ui/button';
import { Upload, CheckCircle, X } from 'lucide-react';

interface SyllabusDropzoneProps {
  selectedFile: File | null;
  onSelect: (file: File | null) => void;
}

/** Single-PDF drag-and-drop picker for the upload-syllabus flow (SYL-39). */
export function SyllabusDropzone({ selectedFile, onSelect }: SyllabusDropzoneProps) {
  const [dragActive, setDragActive] = useState(false);

  const handleFile = (file: File) => {
    if (!file.name.toLowerCase().endsWith('.pdf') && file.type !== 'application/pdf') {
      alert('Only PDF files are supported. Please upload a PDF.');
      return;
    }
    onSelect(file);
  };

  const handleDrag = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (e.type === 'dragenter' || e.type === 'dragover') {
      setDragActive(true);
    } else if (e.type === 'dragleave') {
      setDragActive(false);
    }
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setDragActive(false);
    if (e.dataTransfer.files && e.dataTransfer.files[0]) {
      handleFile(e.dataTransfer.files[0]);
    }
  };

  const handleFileInput = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files[0]) {
      handleFile(e.target.files[0]);
    }
  };

  return (
    <div
      onDragEnter={handleDrag}
      onDragLeave={handleDrag}
      onDragOver={handleDrag}
      onDrop={handleDrop}
      className={`border-2 border-dashed rounded-2xl p-12 text-center transition-colors ${
        dragActive
          ? 'border-indigo-400 bg-indigo-50'
          : 'border-gray-300 hover:border-gray-400'
      }`}
    >
      {!selectedFile ? (
        <>
          <Upload className="w-12 h-12 text-gray-400 mx-auto mb-4" />
          <h3 className="text-lg font-semibold text-gray-900 mb-2">
            Drop your syllabus to get started
          </h3>
          <p className="text-sm text-gray-600 mb-4">
            Accepts PDF files only
          </p>
          <label htmlFor="file-upload" className="cursor-pointer">
            <span className="text-sm text-indigo-600 hover:text-indigo-700 underline">
              Browse files
            </span>
            <input
              id="file-upload"
              type="file"
              accept=".pdf,application/pdf"
              onChange={handleFileInput}
              className="hidden"
            />
          </label>
        </>
      ) : (
        <div className="flex items-center justify-between bg-gray-50 rounded-lg p-4">
          <div className="flex items-center gap-3">
            <CheckCircle className="w-5 h-5 text-green-600" />
            <div className="text-left">
              <p className="text-sm font-medium text-gray-900">
                {selectedFile.name}
              </p>
              <p className="text-xs text-gray-500">
                {(selectedFile.size / 1024).toFixed(1)} KB
              </p>
            </div>
          </div>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => onSelect(null)}
            className="rounded-lg"
          >
            <X className="w-4 h-4" />
          </Button>
        </div>
      )}
    </div>
  );
}
