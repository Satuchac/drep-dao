'use client';

/** Shared profile-photo picker — reads an image file into a data URL (≤256 KB).
 *  Used by the DRep, submitter and expert profile forms. */
export const MAX_PHOTO_BYTES = 256 * 1024;
export const ALLOWED_PHOTO_TYPES = new Set(['image/png', 'image/jpeg', 'image/webp', 'image/gif']);

export function PhotoUpload({
  photo,
  onChange,
  error,
  hint = 'PNG, JPEG, WebP or GIF · max 256 KB',
}: {
  photo: string | null;
  onChange: (next: string | null, error?: string) => void;
  error: string | null;
  hint?: string;
}) {
  const onFile = (file: File) => {
    if (!ALLOWED_PHOTO_TYPES.has(file.type)) {
      onChange(photo, 'Only PNG, JPEG, WebP or GIF images are accepted.');
      return;
    }
    if (file.size > MAX_PHOTO_BYTES) {
      onChange(photo, `Image is ${(file.size / 1024).toFixed(0)} KB — keep it under 256 KB.`);
      return;
    }
    const reader = new FileReader();
    reader.onerror = () => onChange(photo, 'Could not read the image.');
    reader.onload = () => {
      const result = reader.result;
      if (typeof result !== 'string') { onChange(photo, 'Could not read the image.'); return; }
      onChange(result);
    };
    reader.readAsDataURL(file);
  };
  return (
    <div className="space-y-1">
      <span className="text-sm font-medium">Profile photo</span>
      <div className="flex items-center gap-3">
        {photo ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={photo} alt="profile" className="h-16 w-16 rounded-full object-cover ring-1 ring-neutral-300 dark:ring-neutral-700" />
        ) : (
          <div className="flex h-16 w-16 items-center justify-center rounded-full bg-neutral-200 text-xs text-neutral-500 dark:bg-neutral-800">none</div>
        )}
        <div className="space-y-1">
          <input
            type="file"
            accept="image/png,image/jpeg,image/webp,image/gif"
            onChange={(e) => { const file = e.target.files?.[0]; if (file) onFile(file); e.target.value = ''; }}
            className="text-xs file:mr-2 file:rounded-md file:border-0 file:bg-neutral-200 file:px-2 file:py-1 file:text-xs file:font-medium hover:file:bg-neutral-300 dark:file:bg-neutral-800 dark:hover:file:bg-neutral-700"
          />
          {photo ? (
            <button type="button" onClick={() => onChange(null)} className="text-xs text-red-600 hover:underline">Remove</button>
          ) : null}
          <p className="text-[11px] text-neutral-500">{hint}</p>
        </div>
      </div>
      {error ? <p className="text-xs text-red-600">{error}</p> : null}
    </div>
  );
}
