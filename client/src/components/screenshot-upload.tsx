import { useState, useRef } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card } from "@/components/ui/card";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Camera, Scissors, Smartphone, Trash2, Check, Clipboard, Edit3 } from "lucide-react";
import { CropIcon } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { useConfetti } from "@/hooks/use-confetti";
import ReactCrop, { type Crop as ReactCropType } from 'react-image-crop';
import 'react-image-crop/dist/ReactCrop.css';
import { Whiteboard } from "./whiteboard";

interface ScreenshotUploadProps {
  onImageSelect: (image: string) => void;
}

const BADGE_COLORS = [
  "#ef4444", "#3b82f6", "#eab308", "#22c55e", "#a855f7",
  "#f97316", "#ec4899", "#14b8a6", "#6366f1", "#84cc16"
];

export function ScreenshotUpload({ onImageSelect }: ScreenshotUploadProps) {
  const [preview, setPreview] = useState<string | null>(null);
  const [isEditing, setIsEditing] = useState(false);
  const [crop, setCrop] = useState<ReactCropType>();
  const [isWhiteboardOpen, setIsWhiteboardOpen] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const imageRef = useRef<HTMLImageElement>(null);
  const cardRef = useRef<HTMLDivElement>(null);
  const { toast } = useToast();
  const { triggerConfetti } = useConfetti();

  const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent);

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

  const combineMultipleImagesToLargeFeed = async (files: File[]): Promise<string> => {
    const selectedFiles = files.slice(0, 12);
    const images = await Promise.all(selectedFiles.map((f) => loadImageElement(f)));
    
    const cellWidth = 800;
    const cellHeight = 700;
    const padding = 24;
    const labelHeight = 80;

    const canvas = document.createElement("canvas");
    canvas.width = cellWidth + (padding * 2);
    canvas.height = (images.length * (cellHeight + padding)) + padding;

    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("無法建立畫布");

    ctx.fillStyle = "#0f172a";
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    images.forEach((img, index) => {
      const x = padding;
      const y = padding + index * (cellHeight + padding);

      ctx.fillStyle = "#ffffff";
      ctx.fillRect(x, y, cellWidth, cellHeight);

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

      const letter = String.fromCharCode(65 + index);
      const rawName = selectedFiles[index].name.replace(/\.[^/.]+$/, "");
      const badgeColor = BADGE_COLORS[index % BADGE_COLORS.length];

      ctx.fillStyle = "#1e293b";
      ctx.fillRect(x, y + photoAreaHeight, cellWidth, labelHeight);

      ctx.beginPath();
      ctx.arc(x + 45, y + photoAreaHeight + labelHeight / 2, 30, 0, Math.PI * 2);
      ctx.fillStyle = badgeColor;
      ctx.fill();
      ctx.lineWidth = 4;
      ctx.strokeStyle = "#ffffff";
      ctx.stroke();

      ctx.fillStyle = "#ffffff";
      ctx.font = "bold 32px sans-serif";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText(letter, x + 45, y + photoAreaHeight + labelHeight / 2 + 2);

      ctx.fillStyle = "#ffffff";
      ctx.font = "bold 28px sans-serif";
      ctx.textAlign = "left";
      ctx.textBaseline = "middle";
      const displayLabel = `${letter}. ${rawName}`;
      ctx.fillText(displayLabel, x + 95, y + photoAreaHeight + labelHeight / 2 + 2);
    });

    let quality = 0.8;
    let dataUrl = canvas.toDataURL("image/jpeg", quality);
    while (dataUrl.length > 900 * 1024 && quality > 0.3) {
      quality -= 0.1;
      dataUrl = canvas.toDataURL("image/jpeg", quality);
    }
    return dataUrl;
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
        triggerConfetti();
        toast({ title: "上傳成功", variant: "success" });
      } else {
        const feedBase64 = await combineMultipleImagesToLargeFeed(files);
        setPreview(feedBase64);
        onImageSelect(feedBase64);
        triggerConfetti();
        toast({ title: "上傳成功", description: `已成功合成 ${files.length} 張大圖歌手海報！`, variant: "success" });
      }
    } catch {
      toast({ title: "處理失敗", variant: "destructive" });
    }
  };

  const handlePaste = async () => {
    try {
      const clipboard = await navigator.clipboard.read();
      for (const item of clipboard) {
        const imageType = item.types.find(t => t.startsWith('image/'));
        if (imageType) {
          const blob = await item.getType(imageType);
          const base64 = await compressSingleImage(blob);
          setPreview(base64);
          onImageSelect(base64);
          triggerConfetti();
          return;
        }
      }
    } catch {
      toast({ title: "無法讀取剪貼簿", variant: "destructive" });
    }
  };

  const handleDeleteImage = () => {
    setPreview(null);
    if (fileInputRef.current) fileInputRef.current.value = '';
    toast({ title: "已刪除圖片", variant: "success" });
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
    ctx.drawImage(imageRef.current, crop.x * scaleX, crop.y * scaleY, crop.width * scaleX, crop.height * scaleY, 0, 0, crop.width, crop.height);

    const base64 = canvas.toDataURL('image/jpeg', 0.8);
    setPreview(base64);
    onImageSelect(base64);
    setIsEditing(false);
    setCrop(undefined);
  };

  return (
    <Card ref={cardRef} className="p-6">
      <div className="space-y-4">
        <div className="flex items-center gap-4 flex-wrap">
          <Button type="button" onClick={() => setIsWhiteboardOpen(true)} className="bg-yellow-400 text-black hover:bg-yellow-500">
            <Edit3 className="h-4 w-4 mr-2" />手寫白板
          </Button>
          <Button type="button" onClick={() => fileInputRef.current?.click()} className="bg-yellow-400 text-black hover:bg-yellow-500">
            <Camera className="h-4 w-4 mr-2" />上傳 10 張歌手照片（可多選）
          </Button>
          <Button type="button" onClick={handlePaste} className="bg-yellow-400 text-black hover:bg-yellow-500">
            <Clipboard className="h-4 w-4 mr-2" />貼上圖片
          </Button>
          <Input ref={fileInputRef} type="file" accept="image/*" multiple className="hidden" onChange={handleFileSelect} />
        </div>

        {preview && (
          <div className="mt-4 relative rounded-lg overflow-hidden border border-border bg-slate-900 p-2">
            <div className="flex justify-center items-center">
              <img src={preview} alt="預覽圖" className="max-w-full max-h-[70vh] object-contain mx-auto block rounded" />
            </div>
            <div className="absolute top-4 right-4 flex gap-2">
              <Button type="button" size="icon" variant="secondary" onClick={() => setIsEditing(true)}>
                <CropIcon className="h-4 w-4" />
              </Button>
              <Button type="button" size="icon" variant="destructive" onClick={handleDeleteImage}>
                <Trash2 className="h-4 w-4" />
              </Button>
            </div>
          </div>
        )}

        {!preview && (
          <p className="text-sm text-muted-foreground text-center">
            請一次選取多張歌手照片（按住 Ctrl 或 Shift 複選），系統會自動製作成大圖排版串列，方便學生在手機上清晰瀏覽
          </p>
        )}
      </div>

      <Dialog open={isEditing} onOpenChange={setIsEditing}>
        <DialogContent className="max-w-3xl max-h-[80vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>裁切圖片</DialogTitle>
            <DialogDescription>調整藍色框框以選擇保留區域。</DialogDescription>
          </DialogHeader>
          <div className="mt-4">
            <ReactCrop crop={crop} onChange={c => setCrop(c)}>
              <img ref={imageRef} src={preview || ''} className="max-w-full max-h-[60vh] object-contain mx-auto" />
            </ReactCrop>
          </div>
          <div className="flex justify-end gap-2 mt-4 sticky bottom-0 bg-background p-4 border-t">
            <Button type="button" variant="ghost" onClick={() => setIsEditing(false)}>取消</Button>
            <Button type="button" onClick={handleCropComplete} disabled={!crop}><Check className="h-4 w-4 mr-2" />確認裁切</Button>
          </div>
        </DialogContent>
      </Dialog>

      <Whiteboard isOpen={isWhiteboardOpen} onClose={() => setIsWhiteboardOpen(false)} onImageGenerated={(img) => { setPreview(img); onImageSelect(img); }} />
    </Card>
  );
}
