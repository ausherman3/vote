/**
 * 免 Firebase Storage 版本：直接回傳已壓縮的 base64 dataUrl 存入 Firestore
 */
export const uploadImageIfLarge = async (dataUrl: string): Promise<string> => {
    return dataUrl;
};

export const deleteImageFromUrl = async (_url: string | undefined): Promise<void> => {
    return;
};
