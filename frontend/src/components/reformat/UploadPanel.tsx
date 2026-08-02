import { useState, useRef } from 'react';

interface Props {
  onFile: (file: File) => void;
  busy: boolean;
  hasFile: boolean;
  onCancel?: () => void;
}

export default function UploadPanel({ onFile, busy, hasFile, onCancel }: Props) {
  const [dragOver, setDragOver] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  return (
    <div className="bg-white rounded-xl border border-[#d2d2d7] p-6">
      <h2 className="text-[16px] font-semibold text-[#1d1d1f] mb-1">
        {hasFile ? 'Replace the current file' : 'Step 1 — Drop your file'}
      </h2>
      <p className="text-[13px] text-[#6e6e73] mb-5">
        Excel (.xlsx, .xls) or CSV only. The file is processed in your browser — nothing is uploaded or stored on the server.
      </p>

      <div
        onClick={() => !busy && inputRef.current?.click()}
        onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
        onDragLeave={() => setDragOver(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragOver(false);
          const f = e.dataTransfer.files?.[0];
          if (f) onFile(f);
        }}
        className={`border-2 border-dashed rounded-xl p-10 text-center transition-all ${
          busy
            ? 'border-[#d2d2d7] opacity-50'
            : dragOver
              ? 'border-[#2563eb] bg-[#eff6ff]'
              : 'border-[#d2d2d7] hover:border-[#2563eb] cursor-pointer'
        }`}
      >
        <div className={`w-12 h-12 mx-auto mb-4 flex items-center justify-center rounded-xl ${dragOver ? 'bg-[#2563eb] text-white' : 'bg-[#f5f5f7] text-[#2563eb]'}`}>
          <svg className="w-6 h-6" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
            <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
            <polyline points="17 8 12 3 7 8" />
            <line x1="12" y1="3" x2="12" y2="15" />
          </svg>
        </div>
        <p className="text-[14px] text-[#1d1d1f] font-medium">
          {busy ? 'Reading file...' : dragOver ? 'Drop it here' : 'Drag & drop your file here, or click to browse'}
        </p>
        <p className="text-[12px] text-[#9ca3af] mt-1.5">.xlsx &nbsp;&middot;&nbsp; .xls &nbsp;&middot;&nbsp; .csv</p>
        <input
          ref={inputRef}
          type="file"
          accept=".xlsx,.xls,.csv"
          className="hidden"
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) onFile(f);
            e.target.value = '';
          }}
        />
      </div>

      {hasFile && onCancel && (
        <div className="mt-4 flex justify-end">
          <button
            onClick={onCancel}
            className="px-4 py-2 border border-[#d2d2d7] text-[13px] text-[#6e6e73] rounded-lg hover:bg-[#f5f5f7] transition-colors cursor-pointer"
          >
            Cancel — keep current file
          </button>
        </div>
      )}
    </div>
  );
}
