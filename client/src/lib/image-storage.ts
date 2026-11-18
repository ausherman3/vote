/**
 * 圖片儲存 helper（免 Firebase Storage 版本）
 *
 * 直接將圖片壓縮至 Firestore 1MB 限制內並以 base64 inline 儲存，
 * 無需啟用 Firebase Storage 付費方案即可上傳照片給所有投票者觀看。
 */
import { compressImageDataUrl } from "./image-compress";

// 設定 600KB 為上限（遠低於 Firestore 1MB 文件上限）
const MAX_INLINE_BYTES = 600 * 1024;

/**
 * 自動壓縮大圖並回傳可用於 <img src> 的 base64 dataUrl。
 */
export const uploadImageIfLarge = async (dataUrl: string): Promise<string> => {
    try {
        // 使用專案內建的壓縮器將大圖壓縮至 600KB 以內
        return await compressImageDataUrl(dataUrl, MAX_INLINE_BYTES);
    } catch {
        // 若壓縮失敗則直接回傳原圖
        return dataUrl;
    }
};

/**
 * 對 base64 inline 安全 no-op。
 */
export const deleteImageFromUrl = async (_url: string | undefined): Promise<void> => {
    return;
};
