import { Model } from "@/gotypes";
// Shared file validation logic used by both FileUpload and native dialog selection

export const TEXT_FILE_EXTENSIONS = [
  "pdf",
  "docx",
  "txt",
  "md",
  "csv",
  "json",
  "xml",
  "html",
  "htm",
  "js",
  "jsx",
  "ts",
  "tsx",
  "py",
  "java",
  "cpp",
  "c",
  "cc",
  "h",
  "cs",
  "php",
  "rb",
  "go",
  "rs",
  "swift",
  "kt",
  "scala",
  "sh",
  "bat",
  "yaml",
  "yml",
  "toml",
  "ini",
  "cfg",
  "conf",
  "log",
  "rtf",
];

export const IMAGE_EXTENSIONS = ["png", "jpg", "jpeg", "webp"];

export interface FileValidationOptions {
  maxFileSize?: number; // in MB
  allowedExtensions?: string[];
  hasVisionCapability?: boolean;
  selectedModel?: Model | null;
  customValidator?: (file: File) => { valid: boolean; error?: string };
}

export interface ValidationResult {
  valid: boolean;
  error?: string;
}

export function validateFile(
  file: File,
  options: FileValidationOptions = {},
): ValidationResult {
  const {
    maxFileSize = 10,
    allowedExtensions = [...TEXT_FILE_EXTENSIONS, ...IMAGE_EXTENSIONS],
    hasVisionCapability = false,
    customValidator,
  } = options;

  const MAX_FILE_SIZE = maxFileSize * 1024 * 1024; // Convert MB to bytes
  const fileExtension = file.name.toLowerCase().split(".").pop();

  // Custom validation first
  if (customValidator) {
    const customResult = customValidator(file);
    if (!customResult.valid) {
      return customResult;
    }
  }

  // File extension validation
  if (!fileExtension || !allowedExtensions.includes(fileExtension)) {
    return { valid: false, error: "Type de fichier non supporté" };
  }

  if (IMAGE_EXTENSIONS.includes(fileExtension) && !hasVisionCapability) {
    return { valid: false, error: "Ce modèle ne supporte pas les images" };
  }

  // File size validation
  if (file.size > MAX_FILE_SIZE) {
    return { valid: false, error: "Fichier trop volumineux" };
  }

  return { valid: true };
}

// Helper function to read file as Uint8Array
export function readFileAsBytes(file: File): Promise<Uint8Array> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const arrayBuffer = reader.result as ArrayBuffer;
      resolve(new Uint8Array(arrayBuffer));
    };
    reader.onerror = () => reject(reader.error);
    reader.readAsArrayBuffer(file);
  });
}

function resizeImageIfNeeded(data: Uint8Array, mimeType: string, maxDim: number = 1024): Promise<Uint8Array> {
  return new Promise((resolve) => {
    const blob = new Blob([data], { type: mimeType || 'image/jpeg' });
    const url = URL.createObjectURL(blob);

    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);

      if (img.width <= maxDim && img.height <= maxDim) {
        resolve(data);
        return;
      }

      const scale = Math.min(maxDim / img.width, maxDim / img.height);
      const canvas = document.createElement('canvas');
      canvas.width = Math.round(img.width * scale);
      canvas.height = Math.round(img.height * scale);
      canvas.getContext('2d')!.drawImage(img, 0, 0, canvas.width, canvas.height);

      canvas.toBlob((blob) => {
        if (!blob) {
          resolve(data);
          return;
        }
        const reader = new FileReader();
        reader.onload = () => {
          resolve(new Uint8Array(reader.result as ArrayBuffer));
        };
        reader.onerror = () => resolve(data);
        reader.readAsArrayBuffer(blob);
      }, 'image/jpeg', 0.85);
    };

    img.onerror = () => {
      URL.revokeObjectURL(url);
      resolve(data);
    };

    img.src = url;
  });
}

// Process multiple files with validation
export async function processFiles(
  files: File[],
  options: FileValidationOptions = {},
): Promise<{
  validFiles: Array<{ filename: string; data: Uint8Array; type?: string }>;
  errors: Array<{ filename: string; error: string }>;
}> {
  const validFiles: Array<{
    filename: string;
    data: Uint8Array;
    type?: string;
  }> = [];
  const errors: Array<{ filename: string; error: string }> = [];

  for (const file of files) {
    const validation = validateFile(file, options);

    if (!validation.valid) {
      errors.push({
        filename: file.name,
        error: validation.error || "Validation du fichier échouée",
      });
      continue;
    }

    try {
      let fileBytes = await readFileAsBytes(file);

      const ext = file.name.toLowerCase().split(".").pop() || "";
      if (IMAGE_EXTENSIONS.includes(ext)) {
        fileBytes = await resizeImageIfNeeded(fileBytes, file.type || "image/jpeg");
      }

      validFiles.push({
        filename: file.name,
        data: fileBytes,
        type: file.type || undefined,
      });
    } catch (error) {
      console.error(`Error reading file ${file.name}:`, error);
      errors.push({
        filename: file.name,
        error: "Erreur de lecture du fichier",
      });
    }
  }

  return { validFiles, errors };
}
