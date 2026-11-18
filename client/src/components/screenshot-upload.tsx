import { useState, useRef } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card } from "@/components/ui/card";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Camera, Trash2, Check, Clipboard, Edit3, ChevronLeft, ChevronRight, CropIcon } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { useConfetti } from "@/hooks/use-confetti";
import ReactCrop, { type Crop as ReactCropType } from 'react-image-crop';
import 'react-image-crop/dist/ReactCrop.css';
import { Whiteboard } from "./whiteboard";

interface ScreenshotUploadProps {
  onImageSelect: (image: string) => void;
}

interface GalleryItem {
  letter: string;
  name: string;
  url: string;
}

export function ScreenshotUpload({ onImageSelect }: ScreenshotUploadProps) {
  const [preview, setPreview] = useState<string | null>(null);
  const [gallery, setGallery] = useState<GalleryItem[]>([]);
  const [currentIdx, setCurrentIdx] = useState(0);
  const [isEditing, setIsEditing] = useState(false);
  const [crop, setCrop] = useState<ReactCropType>();
  const [isWhiteboardOpen, setIsWhiteboardOpen] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const imageRef = useRef<HTMLImageElement>(null);
  const cardRef = useRef<HTMLDivElement>(null);
  const { toast } = useToast();
  const { triggerConfetti } = useConfetti();

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

  // Compress a single photo to stay under maxBytes
  const compressImageToBudget = async (
    file: File | Blob,
    maxDim: number,
    maxBytes: number
  ): Promise<string> => {
    const img = await loadImageElement(file);
    let width = img.width;
    let height = img.height;

    if (width > maxDim || height > maxDim) {
      if (width > height) {
        height = Math.round((height * maxDim) / width);
        width = maxDim;
      } else {
        width = Math.round((width * maxDim) / height);
        height = maxDim;
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

    let quality = 0.78;
    let dataUrl = canvas.toDataURL("image/jpeg", quality);
    while (dataUrl.length > maxBytes && quality > 0.25) {
      quality -= 0.08;
      dataUrl = canvas.toDataURL("image/jpeg", quality);
    }
    return dataUrl;
  };

  const handleFileSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const fileList = e.target.files;
    if (!fileList || fileList.length === 0) return;
    const files = Array.from(fileList).slice(0, 12);

    try {
      if (files.length === 1) {
        const base64 = await compressImageToBudget(files[0], 1280, 650 * 1024);
        setGallery([]);
        setPreview(base64);
        onImageSelect(base64);
        triggerConfetti();
        toast({ title: "上傳成功", description: "圖片已上傳", variant: "success" });
      } else {
        // Divide ~780KB total budget across all selected singer photos so Firestore 1MB limit is never exceeded
        const perImageBudget = Math.floor((780 * 1024) / files.length);
        const items: GalleryItem[] = await Promise.all(
          files.map(async (file, index) => {
            const url = await compressImageToBudget(file, 720, perImageBudget);
            const letter = String.fromCharCode(65 + index);
            const name = file.name.replace(/\.[^/.]+$/, "");
            return { letter, name, url };
          })
        );

        const encoded = "GALLERY::" + JSON.stringify(items);
        setGallery(items);
        setCurrentIdx(0);
        setPreview(null);
        onImageSelect(encoded);
        triggerConfetti();
        toast({
          title: "上傳成功",
          description: `已載入 ${items.length} 張歌手照片，觀眾可在手機左右滑動一張張看大圖！`,
          variant: "success",
        });
      }
    } catch {
      toast({
        title: "圖片處理失敗",
        description: "請確認選擇的檔案為有效的圖片格式",
        variant: "destructive",
      });
    }
  };

  const handlePaste = async () => {
    try {
      const clipboard = await navigator.clipboard.read();
      for (const item of clipboard) {
        const imageType = item.types.find((t) => t.startsWith("image/"));
        if (imageType) {
          const blob = await item.getType(imageType);
          const base64 = await compressImageToBudget(blob, 1280, 650 * 1024);
          setGallery([]);
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
    setGallery([]);
    setCurrentIdx(0);
    if (fileInputRef.current) fileInputRef.current.value = "";
    toast({ title: "已刪除圖片", variant: "success" });
  };

  const handleCropComplete = () => {
    if (!imageRef.current || !crop) return;
    const canvas = document.createElement("canvas");
    const ctx = canvas.getContext("2d");
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

    const base64 = canvas.toDataURL("image/jpeg", 0.8);
    setPreview(base64);
    onImageSelect(base64);
    setIsEditing(false);
    setCrop(undefined);
  };

  return (
    <Card ref={cardRef} className="p-6">
      <div className="space-y-4">
        <div className="flex items-center gap-4 flex-wrap">
          <Button
            type="button"
            onClick={() => setIsWhiteboardOpen(true)}
            className="bg-yellow-400 text-black hover:bg-yellow-500"
          >
            <Edit3 className="h-4 w-4 mr-2" />
            手寫白板
          </Button>
          <Button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            className="bg-yellow-400 text-black hover:bg-yellow-500"
          >
            <Camera className="h-4 w-4 mr-2" />
            上傳 10 張歌手照片（可多選）
          </Button>
          <Button
            type="button"
            onClick={handlePaste}
            className="bg-yellow-400 text-black hover:bg-yellow-500"
          >
            <Clipboard className="h-4 w-4 mr-2" />
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

        {/* Multi-photo swipe preview */}
        {gallery.length > 0 && (
          <div className="space-y-3">
            <div className="relative rounded-xl overflow-hidden border border-border bg-slate-900 flex items-center justify-center min-h-[320px]">
              <img
                src={gallery[currentIdx].url}
                alt={gallery[currentIdx].name}
                className="max-h-[55vh] w-auto object-contain"
              />
              <div className="absolute top-3 left-3 bg-black/75 text-white px-3 py-1 rounded-full text-sm font-bold">
                {gallery[currentIdx].letter}. {gallery[currentIdx].name}
              </div>
              <div className="absolute bottom-3 right-3 bg-black/75 text-white px-3 py-1 rounded-full text-xs font-bold">
                {currentIdx + 1} / {gallery.length}
              </div>
              <Button
                type="button"
                size="icon"
                variant="secondary"
                className="absolute left-2 top-1/2 -translate-y-1/2 rounded-full bg-white/80 hover:bg-white"
                onClick={() => setCurrentIdx((i) => (i - 1 + gallery.length) % gallery.length)}
              >
                <ChevronLeft className="h-5 w-5" />
              </Button>
              <Button
                type="button"
                size="icon"
                variant="secondary"
                className="absolute right-2 top-1/2 -translate-y-1/2 rounded-full bg-white/80 hover:bg-white"
                onClick={() => setCurrentIdx((i) => (i + 1) % gallery.length)}
              >
                <ChevronRight className="h-5 w-5" />
              </Button>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-xs text-muted-foreground">
                觀眾在手機上可左右滑動一張張檢視這 {gallery.length} 張照片
              </span>
              <Button type="button" variant="destructive" size="sm" onClick={handleDeleteImage}>
                <Trash2 className="h-4 w-4 mr-1" />
                清除全部
              </Button>
            </div>
          </div>
        )}

        {/* Single-photo preview */}
        {preview && gallery.length === 0 && (
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

        {!preview && gallery.length === 0 && (
          <p className="text-sm text-muted-foreground text-center">
            按住 Ctrl 或 Shift 一次選取 10 張歌手照片，觀眾就能在手機上左右滑動一張張看大圖
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
            <ReactCrop crop={crop} onChange={(c) => setCrop(c)}>
              <img ref={imageRef} src={preview || ""} alt="裁切預覽" className="max-w-full max-h-[60vh] object-contain mx-auto" />
            </ReactCrop>
          </div>
          <div className="flex justify-end gap-2 mt-4 sticky bottom-0 bg-background p-4 border-t">
            <Button type="button" variant="ghost" onClick={() => setIsEditing(false)}>取消</Button>
            <Button type="button" onClick={handleCropComplete} disabled={!crop}>
              <Check className="h-4 w-4 mr-2" />
              確認裁切
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      <Whiteboard
        isOpen={isWhiteboardOpen}
        onClose={() => setIsWhiteboardOpen(false)}
        onImageGenerated={(img) => {
          setGallery([]);
          setPreview(img);
          onImageSelect(img);
        }}
      />
    </Card>
  );
}
