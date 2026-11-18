import { useState, useRef, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card } from "@/components/ui/card";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Camera, Scissors, Smartphone, Trash2, Check, Clipboard, Edit3, Palette } from "lucide-react";
import { CropIcon } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { useConfetti } from "@/hooks/use-confetti";
import ReactCrop, { type Crop as ReactCropType } from 'react-image-crop';
import 'react-image-crop/dist/ReactCrop.css';
import { Whiteboard } from "./whiteboard";
import { ImageAnnotator } from "./image-annotator";

interface ScreenshotUploadProps {
  onImageSelect: (image: string) => void;
}

const BADGE_COLORS = [
  "#ef4444", // A - Red
  "#3b82f6", // B - Blue
  "#eab308", // C - Yellow
  "#22c55e", // D - Green
  "#a855f7", // E - Purple
  "#f97316", // F - Orange
  "#ec4899", // G - Pink
  "#14b8a6", // H - Teal
  "#6366f1", // I - Indigo
  "#84cc16", // J - Lime
];

export function ScreenshotUpload({ onImageSelect }: ScreenshotUploadProps) {
  const [preview, setPreview] = useState<string | null>(null);
  const [isEditing, setIsEditing] = useState(false);
  const [crop, setCrop] = useState<ReactCropType>();
  const [isWhiteboardOpen, setIsWhiteboardOpen] = useState(false);
  const [isAnnotatorOpen, setIsAnnotatorOpen] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const imageRef = useRef<HTMLImageElement>(null);
  const cardRef = useRef<HTMLDivElement>(null);
  const { toast } = useToast();
  const { triggerConfetti } = useConfetti();

  const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent);

  // 將單張圖片讀取為 HTMLImageElement
  const loadImageElement = (file: File | Blob): Promise<HTMLImageElement> => {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => {
        const img = new Image();
        img.onload = () => resolve(img);
        img.onerror = reject;
        img.src = reader.result as string;
      };
      reader.onerror = reject;
      reader.readAsDataURL(file);
    });
  };

  // 壓縮單張圖片至安全大小（確保低於 Firestore 1MB 限制）
  const compressSingleImage = async (file: File | Blob): Promise<string> => {
    const img = await loadImageElement(file);
    const MAX_DIM = 1280;
    let width = img.width;
    let height = img.height;

    if (width > MAX_DIM || height > MAX_DIM) {
      if (width > height) {
        height = Math.round((height * MAX_DIM) / width);
        width = MAX_DIM;
      } else {
        width = Math.round((width * MAX_DIM) / height);
        height = MAX_DIM;
      }
    }

    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext("2d");
    if (!ctx) return img.src;

    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, width, height);
    ctx.drawImage(img, 0, 0, width, height);

    let quality = 0.75;
    let dataUrl = canvas.toDataURL("image/jpeg", quality);
    while (dataUrl.length > 650 * 1024 && quality > 0.3) {
      quality -= 0.1;
      dataUrl = canvas.toDataURL("image/jpeg", quality);
    }
    return dataUrl;
  };

  // 將多張歌手照片自動拼成放大且清晰的 A~J 編號與姓名的海報網格
  const combineMultipleImagesToGrid = async (files: File[]): Promise<string> => {
    const selectedFiles = files.slice(0, 12); // 最多支援 12 張（例如 10 位歌手）
    const images = await Promise.all(selectedFiles.map((f) => loadImageElement(f)));
    const count = images.length;

    // 改為 2 欄排版（若只有 1 張則 1 欄），讓每張歌手照片變得非常大且清晰
    const cols = count <= 1 ? 1 : 2;
    const rows = Math.ceil(count / cols);

    const cellWidth = 500;  // 放大卡片寬度
    const cellHeight = 580; // 放大卡片高度
    const padding = 20;
    const labelHeight = 65; // 放大底部名稱列空間

    const canvas = document.createElement("canvas");
    canvas.width = cols * cellWidth + (cols + 1) * padding;
    canvas.height = rows * cellHeight + (rows + 1) * padding;

    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("無法建立畫布");

    // 深色舞台背景
    ctx.fillStyle = "#1e293b";
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    images.forEach((img, index) => {
      const col = index % cols;
      const row = Math.floor(index / cols);
      const x = padding + col * (cellWidth + padding);
      const y = padding + row * (cellHeight + padding);

      // 卡片白色底框
      ctx.fillStyle = "#ffffff";
      ctx.fillRect(x, y, cellWidth, cellHeight);

      // 照片區（置中裁切填滿 cover 模式）
      const photoAreaHeight = cellHeight - labelHeight;
      const imgRatio = img.width / img.height;
      const targetRatio = cellWidth / photoAreaHeight;
      let sx = 0, sy = 0, sWidth = img.width, sHeight = img.height;

      if (imgRatio > targetRatio) {
        sWidth = img.height * targetRatio;
        sx = (img.width - sWidth) / 2;
      } else {
        sHeight = img.width / targetRatio;
        sy = (img.height - sHeight) / 2;
      }

      ctx.drawImage(img, sx, sy, sWidth, sHeight, x, y, cellWidth, photoAreaHeight);

      // 底部歌手名稱列（自動讀取檔名）
      const letter = String.fromCharCode(65 + index); // A, B, C...
      const rawName = selectedFiles[index].name.replace(/\.[^/.]+$/, "");
      const badgeColor = BADGE_COLORS[index % BADGE_COLORS.length];

      ctx.fillStyle = "#0f172a";
      ctx.fillRect(x, y + photoAreaHeight, cellWidth, labelHeight);

      // 左上角放大彩色 A/B/C 圓形徽章
      ctx.beginPath();
      ctx.arc(x + 36, y + 36, 28, 0, Math.PI * 2);
      ctx.fillStyle = badgeColor;
      ctx.fill();
      ctx.lineWidth = 3.5;
      ctx.strokeStyle = "#ffffff";
      ctx.stroke();

      ctx.fillStyle = "#ffffff";
      ctx.font = "bold 28px sans-serif";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText(letter, x + 36, y + 37);

      // 底部文字：代號 + 檔名（放大字型）
      ctx.fillStyle = "#ffffff";
      ctx.font = "bold 24px sans-serif";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      const displayLabel = `${letter}. ${rawName}`.slice(0, 22);
      ctx.fillText(displayLabel, x + cellWidth / 2, y + photoAreaHeight + labelHeight / 2);
    });

    // 自動控制壓縮品質，確保總大小 < 650KB
    let quality = 0.78;
    let dataUrl = canvas.toDataURL("image/jpeg", quality);
    while (dataUrl.length > 650 * 1024 && quality > 0.3) {
      quality -= 0.1;
      dataUrl = canvas.toDataURL("image/jpeg", quality);
    }
    return dataUrl;
  };

  // Handle clipboard paste
  const handlePaste = async (clipboardItems?: DataTransferItemList) => {
    if (!clipboardItems) {
      const clipboard = await navigator.clipboard.read().catch(() => null);
      if (!clipboard) {
        toast({
          title: "無法存取剪貼簿",
          description: "請確保已授予網站剪貼簿存取權限",
          variant: "destructive",
        });
        return;
      }

      for (const item of clipboard) {
        const imageType = item.types.find(type => type.startsWith('image/'));
        if (imageType) {
          const blob = await item.getType(imageType);
          const base64 = await compressSingleImage(blob);
          setPreview(base64);
          onImageSelect(base64);
          handleUploadSuccess();
          return;
        }
      }
    } else {
      for (let i = 0; i < clipboardItems.length; i++) {
        if (clipboardItems[i].type.indexOf('image') !== -1) {
          const blob = clipboardItems[i].getAsFile();
          if (!blob) continue;

          const base64 = await compressSingleImage(blob);
          setPreview(base64);
          onImageSelect(base64);
          handleUploadSuccess();
          return;
        }
      }
    }

    toast({
      title: "未找到圖片",
      description: "請確保已複製圖片到剪貼簿",
      variant: "destructive",
    });
  };

  // Add paste event listener
  useEffect(() => {
    const pasteHandler = (e: ClipboardEvent) => {
      e.preventDefault();
      handlePaste(e.clipboardData?.items);
    };

    const card = cardRef.current;
    if (card) {
      card.addEventListener('paste', pasteHandler);
      card.tabIndex = 0;
    }

    return () => {
      if (card) {
        card.removeEventListener('paste', pasteHandler);
      }
    };
  }, [handlePaste]);

  const handleUploadSuccess = (count = 1) => {
    triggerConfetti();
    toast({
      title: "上傳成功",
      description: count > 1 ? `已自動將 ${count} 張照片合成為大圖 A~${String.fromCharCode(64 + count)} 歌手海報！` : "圖片已成功上傳",
      variant: "success",
    });
  };

  const handleFileSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const fileList = e.target.files;
    if (!fileList || fileList.length === 0) return;

    const files = Array.from(fileList);

    try {
      if (files.length === 1) {
        const base64 = await compressSingleImage(files[0]);
        setPreview(base64);
        onImageSelect(base64);
        handleUploadSuccess(1);
      } else {
        // 選擇多張圖片時，自動合成為放大版 A~J 編號網格
        const gridBase64 = await combineMultipleImagesToGrid(files);
        setPreview(gridBase64);
        onImageSelect(gridBase64);
        handleUploadSuccess(Math.min(files.length, 12));
      }
    } catch {
      toast({
        title: "圖片處理失敗",
        description: "請確認選擇的檔案為有效的圖片格式",
        variant: "destructive",
      });
    }
  };

  const compressImage = (canvas: HTMLCanvasElement, quality = 0.7): string => {
    const MAX_WIDTH = 1280;
    const scale = MAX_WIDTH / canvas.width;

    if (scale >= 1) {
      return canvas.toDataURL('image/jpeg', quality);
    }

    const scaledCanvas = document.createElement('canvas');
    const scaledWidth = canvas.width * scale;
    const scaledHeight = canvas.height * scale;
    scaledCanvas.width = scaledWidth;
    scaledCanvas.height = scaledHeight;

    const ctx = scaledCanvas.getContext('2d');
    if (!ctx) return canvas.toDataURL('image/jpeg', quality);

    ctx.drawImage(canvas, 0, 0, scaledWidth, scaledHeight);
    return scaledCanvas.toDataURL('image/jpeg', quality);
  };

  const focusWindow = () => {
    requestAnimationFrame(() => {
      window.focus();
      setTimeout(() => {
        window.focus();
        handleUploadSuccess();
      }, 100);
    });
  };

  const handleScreenshot = async (isMobile: boolean) => {
    if (isIOS && isMobile) {
      toast({
        title: "iOS 設備截圖說明",
        description: "請依照以下步驟操作：\n1. 使用 iOS 內建截圖功能 (電源鍵 + 音量上鍵)\n2. 點擊「上傳圖片」按鈕\n3. 從相簿中選擇剛才的截圖",
        variant: "default",
      });
      return;
    }

    try {
      const constraints: MediaStreamConstraints = {
        video: {
          frameRate: { ideal: 30 },
          width: { ideal: isMobile ? 1080 : 1920 },
          height: { ideal: isMobile ? 1920 : 1080 },
        },
        audio: false
      };

      const stream = await navigator.mediaDevices.getDisplayMedia(constraints);

      const video = document.createElement('video');
      video.srcObject = stream;
      await video.play();

      const canvas = document.createElement('canvas');
      canvas.width = video.videoWidth;
      canvas.height = video.videoHeight;
      const ctx = canvas.getContext('2d');
      if (!ctx) return;

      ctx.drawImage(video, 0, 0, canvas.width, canvas.height);

      stream.getTracks().forEach(track => track.stop());

      const base64 = compressImage(canvas);
      setPreview(base64);
      onImageSelect(base64);

      focusWindow();

    } catch (err) {
      toast({
        title: "截圖失敗",
        description: isMobile
          ? "無法截取手機/平板畫面，請嘗試以下步驟：\n1. 確保已授予螢幕錄製權限\n2. 選擇要分享的畫面\n3. 如果使用iOS裝置，請使用系統截圖功能後再上傳"
          : "截圖失敗，請確保已授予螢幕錄製權限",
        variant: "destructive",
      });
      focusWindow();
    }
  };

  const handleDeleteImage = () => {
    setPreview(null);
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
    toast({
      title: "刪除成功",
      description: "圖片已被刪除",
      variant: "success",
    });
  };

  const handleCropComplete = () => {
    if (!imageRef.current || !crop) return;

    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const scaleX = imageRef.current.naturalWidth / imageRef.current.width;
    const scaleY = imageRef.current.naturalHeight / imageRef.current.height;

    canvas.width = crop.width;
    canvas.height = crop.height;

    ctx.drawImage(
      imageRef.current,
      crop.x * scaleX,
      crop.y * scaleY,
      crop.width * scaleX,
      crop.height * scaleY,
      0,
      0,
      crop.width,
      crop.height
    );

    const base64 = canvas.toDataURL('image/jpeg', 0.8);
    setPreview(base64);
    onImageSelect(base64);
    setIsEditing(false);
    setCrop(undefined);
    toast({
      title: "裁切成功",
      description: "圖片已成功裁切",
      variant: "success",
    });
  };

  return (
    <Card ref={cardRef} className="p-6">
      <div className="space-y-4">
        <div className="flex items-center gap-4 flex-wrap">
          <Button
            type="button"
            onClick={() => setIsWhiteboardOpen(true)}
            className="flex items-center gap-2 transition-all duration-300 hover:shadow-md hover:scale-[1.02] bg-gradient-to-r from-yellow-400 via-amber-400 to-yellow-500 text-black hover:from-yellow-500 hover:via-amber-500 hover:to-yellow-600"
          >
            <Edit3 className="h-4 w-4" />
            手寫白板
          </Button>
          <Button
            type="button"
            onClick={() => handleScreenshot(false)}
            className="flex items-center gap-2 transition-all duration-300 hover:shadow-md hover:scale-[1.02] bg-gradient-to-r from-yellow-400 via-amber-400 to-yellow-500 text-black hover:from-yellow-500 hover:via-amber-500 hover:to-yellow-600"
          >
            <Scissors className="h-4 w-4" />
            電腦截圖
          </Button>
          <Button
            type="button"
            onClick={() => handleScreenshot(true)}
            className="flex items-center gap-2 transition-all duration-300 hover:shadow-md hover:scale-[1.02] bg-gradient-to-r from-yellow-400 via-amber-400 to-yellow-500 text-black hover:from-yellow-500 hover:via-amber-500 hover:to-yellow-600"
          >
            <Smartphone className="h-4 w-4" />
            手機/平板截圖
          </Button>
          <Button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            className="flex items-center gap-2 transition-all duration-300 hover:shadow-md hover:scale-[1.02] bg-gradient-to-r from-yellow-400 via-amber-400 to-yellow-500 text-black hover:from-yellow-500 hover:via-amber-500 hover:to-yellow-600"
          >
            <Camera className="h-4 w-4" />
            上傳圖片（可多選）
          </Button>
          <Button
            type="button"
            onClick={() => handlePaste()}
            className="flex items-center gap-2 transition-all duration-300 hover:shadow-md hover:scale-[1.02] bg-gradient-to-r from-yellow-400 via-amber-400 to-yellow-500 text-black hover:from-yellow-500 hover:via-amber-500 hover:to-yellow-600"
          >
            <Clipboard className="h-4 w-4" />
            貼上圖片
          </Button>
          <Input
            ref={fileInputRef}
            type="file"
            accept="image/*"
            multiple
            className="hidden"
            onChange={handleFileSelect}
          />
        </div>

        {preview && (
          <div className="mt-4 relative rounded-lg overflow-hidden border border-border">
            <div className="flex justify-center items-center min-h-[200px]">
              <img
                src={preview}
                alt="預覽圖"
                className="max-w-full max-h-[70vh] w-auto h-auto object-contain mx-auto block"
                style={{ aspectRatio: 'auto' }}
              />
            </div>
            <div className="absolute top-2 right-2 flex gap-2">
              <Button
                type="button"
                size="icon"
                variant="secondary"
                className="bg-white/80 hover:bg-white transition-all duration-300 hover:scale-110"
                onClick={() => setIsAnnotatorOpen(true)}
                title="圖片標註"
              >
                <Palette className="h-4 w-4" />
              </Button>
              <Button
                type="button"
                size="icon"
                variant="secondary"
                className="bg-white/80 hover:bg-white transition-all duration-300 hover:scale-110"
                onClick={() => setIsEditing(true)}
                title="裁切圖片"
              >
                <CropIcon className="h-4 w-4" />
              </Button>
              <Button
                type="button"
                size="icon"
                variant="destructive"
                className="bg-white/80 hover:bg-red-500 transition-all duration-300 hover:scale-110"
                onClick={handleDeleteImage}
                title="刪除圖片"
              >
                <Trash2 className="h-4 w-4" />
              </Button>
            </div>
          </div>
        )}

        {/* 只在非編輯模式下顯示驗證提示 */}
        {!isEditing && !preview && (
          <p className="text-sm text-muted-foreground text-center animate-fade-in">
            請先上傳或截取圖片（按住 Ctrl 或 Shift 可一次選取 10 張歌手照片自動合成放大海報）
          </p>
        )}
      </div>

      <Dialog open={isEditing} onOpenChange={setIsEditing}>
        <DialogContent className="max-w-3xl max-h-[80vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>裁切圖片</DialogTitle>
            <DialogDescription>
              調整藍色框框以選擇您想要保留的區域。
            </DialogDescription>
          </DialogHeader>
          <div className="mt-4">
            <ReactCrop
              crop={crop}
              onChange={c => setCrop(c)}
              aspect={undefined}
            >
              <img
                ref={imageRef}
                src={preview || ''}
                alt="裁切預覽"
                className="max-w-full max-h-[60vh] w-auto h-auto object-contain mx-auto"
              />
            </ReactCrop>
          </div>
          <div className="flex justify-end gap-2 mt-4 sticky bottom-0 bg-background p-4 border-t">
            <Button
              type="button"
              variant="ghost"
              onClick={() => setIsEditing(false)}
            >
              取消
            </Button>
            <Button
              type="button"
              onClick={handleCropComplete}
              className="flex items-center gap-2"
              disabled={!crop}
            >
              <Check className="h-4 w-4" />
              確認裁切
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* Whiteboard Component */}
      <Whiteboard
        isOpen={isWhiteboardOpen}
        onClose={() => setIsWhiteboardOpen(false)}
        onImageGenerated={(image) => {
          setPreview(image);
          onImageSelect(image);
          handleUploadSuccess();
        }}
      />

      {/* Image Annotator Component */}
      {preview && (
        <ImageAnnotator
          imageUrl={preview}
          isOpen={isAnnotatorOpen}
          onClose={() => setIsAnnotatorOpen(false)}
          onImageUpdated={(image) => {
            setPreview(image);
            onImageSelect(image);
          }}
        />
      )}
    </Card>
  );
}
