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

  // 將多張歌手照片自動拼成帶 A~J 編號與姓名的海報網格
  const combineMultipleImagesToGrid = async (files: File[]): Promise<string> => {
    const selectedFiles = files.slice(0, 12); // 最多支援 12 張（例如 10 位歌手）
    const images = await Promise.all(selectedFiles.map((f) => loadImageElement(f)));
    const count = images.length;

    // 決定網格欄數（10 張照片會排成 5 欄 x 2 列）
    const cols = count <= 2 ? 2 : count <= 4 ? 2 : count <= 6 ? 3 : count <= 8 ? 4 : 5;
    const rows = Math.ceil(count / cols);

    const cellWidth = 300;
    const cellHeight = 360;
    const padding = 16;
    const labelHeight = 46;

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

      // 底部歌手名稱列（自動讀取檔名，例如 "1號 陳小明.jpg" -> "1號 陳小明"）
      const letter = String.fromCharCode(65 + index); // A, B, C...
      const rawName = selectedFiles[index].name.replace(/\.[^/.]+$/, "");
      const badgeColor = BADGE_COLORS[index % BADGE_COLORS.length];

      ctx.fillStyle = "#0f172a";
      ctx.fillRect(x, y + photoAreaHeight, cellWidth, labelHeight);

      // 左上角彩色 A/B/C 圓形徽章
      ctx.beginPath();
      ctx.arc(x + 28, y + 28, 22, 0, Math.PI * 2);
      ctx.fillStyle = badgeColor;
      ctx.fill();
      ctx.lineWidth = 3;
      ctx.strokeStyle = "#ffffff";
      ctx.stroke();

      ctx.fillStyle = "#ffffff";
      ctx.font = "bold 24px sans-serif";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText(letter, x + 28, y + 29);

      // 底部文字：代號 + 檔名
      ctx.fillStyle = "#ffffff";
      ctx.font = "bold 20px sans-serif";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      const displayLabel = `${letter}. ${rawName}`.slice(0, 16);
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
