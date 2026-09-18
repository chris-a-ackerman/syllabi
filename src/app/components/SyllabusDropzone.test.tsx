// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { SyllabusDropzone } from './SyllabusDropzone';

// SYL-68: the one dropzone behind the single upload, bulk upload, add-semester
// and onboarding flows. Pins the multi/single split and the PDF filter.

const pdf = (name: string) => new File(['%PDF-1.4'], name, { type: 'application/pdf' });
const png = new File(['x'], 'photo.png', { type: 'image/png' });

/** Mirrors how e2e/render-pass.mjs drops: on the parent of the title <p>. */
function dropOnZone(title: string, files: File[]) {
  const zone = screen.getByText(title).parentElement!;
  fireEvent.drop(zone, { dataTransfer: { files } });
}

afterEach(cleanup);

describe('SyllabusDropzone', () => {
  it('hands every dropped PDF to onFiles when multiple, ignoring non-PDFs', () => {
    const onFiles = vi.fn();
    render(<SyllabusDropzone multiple onFiles={onFiles} />);
    dropOnZone('Drop PDF syllabi here', [pdf('a.pdf'), png, pdf('b.pdf')]);
    expect(onFiles).toHaveBeenCalledTimes(1);
    expect(onFiles.mock.calls[0][0].map((f: File) => f.name)).toEqual(['a.pdf', 'b.pdf']);
    expect(screen.queryByText(/Only PDF files/)).toBeNull();
  });

  it('hands only the first PDF over in single-file mode', () => {
    const onFiles = vi.fn();
    render(<SyllabusDropzone onFiles={onFiles} title="Drop your syllabus to get started" />);
    dropOnZone('Drop your syllabus to get started', [pdf('a.pdf'), pdf('b.pdf')]);
    expect(onFiles.mock.calls[0][0].map((f: File) => f.name)).toEqual(['a.pdf']);
  });

  it('accepts a .pdf by extension even without a MIME type', () => {
    const onFiles = vi.fn();
    render(<SyllabusDropzone onFiles={onFiles} />);
    dropOnZone('Drop PDF syllabi here', [new File(['%PDF'], 'Syllabus.PDF', { type: '' })]);
    expect(onFiles).toHaveBeenCalledTimes(1);
  });

  it('explains a drop that contained no PDF instead of calling onFiles', () => {
    const onFiles = vi.fn();
    render(<SyllabusDropzone multiple onFiles={onFiles} />);
    dropOnZone('Drop PDF syllabi here', [png]);
    expect(onFiles).not.toHaveBeenCalled();
    expect(screen.getByText('Only PDF files are supported.')).toBeTruthy();
  });

  it('shows the selected file with a clear button in single-file mode', () => {
    const onClear = vi.fn();
    render(<SyllabusDropzone onFiles={vi.fn()} selectedFile={pdf('chem.pdf')} onClear={onClear} />);
    expect(screen.getByText('chem.pdf')).toBeTruthy();
    expect(screen.queryByText('Drop PDF syllabi here')).toBeNull();
    fireEvent.click(screen.getByRole('button'));
    expect(onClear).toHaveBeenCalledTimes(1);
  });
});
