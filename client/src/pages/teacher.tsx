import { useState, useEffect, useRef } from "react";
import { useMutation } from "@tanstack/react-query";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { ScreenshotUpload } from "@/components/screenshot-upload";
import { QRDisplay } from "@/components/qr-display";
import { VotingStats } from "@/components/voting-stats";
import { ShareButton } from "@/components/share-button";
import { useToast } from "@/hooks/use-toast";
import { useVotingSound } from "@/hooks/use-voting-sounds";
import * as firestore from "@/lib/firestore-voting";
import { auth, signInWithGoogle, signOut } from "@/lib/firebase";
import { INAPP_ERROR_CODE } from "@/lib/inapp-browser";
import { onAuthStateChanged, type User } from "firebase/auth";
import { Plus, Minus, Sparkles, RefreshCw, CheckCircle2, Eye, EyeOff, LogIn, LogOut, UserCircle, LayoutGrid, Download, Monitor, Timer, UserCheck, X as XIcon, CheckSquare, Circle, Pencil, GripVertical, ChevronLeft, ChevronRight, Wand2, Rocket, Star } from "lucide-react";
import { EditQuestionDialog } from "@/components/edit-question-dialog";
import { WordCloud } from "@/components/word-cloud";
import { motion, Reorder } from "framer-motion";
import { Link } from "wouter";
import { exportQuestionVotes } from "@/lib/csv-export";
import { compressImageToFit } from "@/lib/image-compress";
import { uploadImageIfLarge } from "@/lib/image-storage";
import { errorDetails, reportServiceEvent } from "@/lib/telemetry";

// Playful Campus 選項色塊（A/B/C/D… 一順輪轉，背景淡色 + 圓點主色）
const OPT_PALETTES = [
  { bg: "#FEE2E2", dot: "#EF4444", name: "red" },
  { bg: "#DBEAFE", dot: "#3B82F6", name: "blue" },
  { bg: "#FEF3C7", dot: "#F59E0B", name: "amber" },
  { bg: "#D1FAE5", dot: "#10B981", name: "green" },
  { bg: "#EDE9FE", dot: "#8B5CF6", name: "purple" },
  { bg: "#FCE7F3", dot: "#F472B6", name: "pink" },
];

export default function Teacher() {
  const [imageUrl, setImageUrl] = useState("");
  // 選項用 { id, value } 而非純 string，給 framer-motion Reorder 穩定 key 用
  type OptionItem = { id: string; value: string };
  const newOptionId = () => `opt_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
  const [options, setOptions] = useState<OptionItem[]>(() => [
    { id: newOptionId(), value: "" },
    { id: newOptionId(), value: "" },
    { id: newOptionId(), value: "" },
  ]);
  const [questionType, setQuestionType] = useState<"single" | "multiple" | "truefalse" | "shortanswer">("single");
  const [editDialogOpen, setEditDialogOpen] = useState(false);

  // 建題介面模式：quick（單頁，預設）/ wizard（新手分步驟）
  const [formMode, setFormMode] = useState<"wizard" | "quick">(
    () => (localStorage.getItem("teacher_form_mode") as any) || "quick"
  );
  const [wizardStep, setWizardStep] = useState<1 | 2 | 3>(1);
  const switchFormMode = (m: "wizard" | "quick") => {
    setFormMode(m);
    localStorage.setItem("teacher_form_mode", m);
    if (m === "wizard") setWizardStep(1);
  };
  const [requireIdentity, setRequireIdentity] = useState(false);
  const [createdQuestion, setCreatedQuestion] = useState<any | null>(null);
  const [globalActiveQuestion, setGlobalActiveQuestion] = useState<any | null>(null);
  const [votesStats, setVotesStats] = useState<Record<number, number>>({});
  const [currentUser, setCurrentUser] = useState<User | null>(null);
  const { toast } = useToast();
  const { playVoteSessionStart, playVoteSubmitted } = useVotingSound();

  useEffect(() => onAuthStateChanged(auth, setCurrentUser), []);

  // 從 dashboard「查看」按鈕進來時，URL 會帶 ?q=<id>，自動載入該題
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const qid = params.get("q");
    if (!qid) return;
    firestore.getQuestion(qid).then((q) => {
      if (q) setCreatedQuestion(q);
    });
    // 載入後把 query string 從網址抹掉，避免重新整理重複載入
    const url = new URL(window.location.href);
    url.searchParams.delete("q");
    window.history.replaceState({}, "", url.toString());
  }, []);

  const handleGoogleSignIn = async () => {
    try {
      const user = await signInWithGoogle();
      const name = user.displayName?.split(" ")[0] ?? user.email?.split("@")[0] ?? "老師";
      reportServiceEvent({
        status: "success",
        title: "老師登入成功",
        context: "teacher.googleSignIn",
        progress: "Google 登入完成，可建立與管理題目",
        details: { email: user.email, uid: user.uid },
      });
      toast({
        title: `👋 歡迎回來，${name}！`,
        description: "你的題目從此跨裝置同步，換電腦也找得到。",
        variant: "success",
      });
    } catch (err: any) {
      if (err?.code === "auth/popup-closed-by-user") return;
      if (err?.code === "auth/cancelled-popup-request") return;
      if (err?.code === INAPP_ERROR_CODE) return; // 已顯示「改用瀏覽器開啟」引導
      reportServiceEvent({
        status: "failed",
        title: "老師登入失敗",
        context: "teacher.googleSignIn",
        progress: "Google 登入流程失敗",
        message: err?.message ?? "登入失敗",
        details: errorDetails(err),
      });
      toast({
        title: "登入失敗",
        description: err?.message ?? "請稍後再試",
        variant: "destructive",
      });
    }
  };

  const handleSignOut = async () => {
    await signOut();
    toast({
      title: "已登出",
      description: "下次回來請再次用 Google 登入以找回你的題目",
    });
  };

  // 監聽背景活動問題 (用於顯示提示)
  useEffect(() => {
    const unsubscribe = firestore.getActiveQuestion((question) => {
      setGlobalActiveQuestion(question);
    });
    return () => unsubscribe();
  }, []);

  // 監聽目前管理的特定問題 (確保 correctAnswer/showAnswer 同步)
  useEffect(() => {
    if (createdQuestion?.id) {
      const unsubscribe = firestore.listenToQuestion(createdQuestion.id, (question) => {
        if (question) {
          setCreatedQuestion(question);
        }
      });
      return () => unsubscribe();
    }
  }, [createdQuestion?.id]);

  // 監聽投票統計
  // 用「投票人數」變化偵測新票（多選一張票會貢獻多個 stat 值，不能用 sum）
  // 用 ref 而非反覆寫 import — 後者在 ESM 嚴格模式被 esbuild 拒絕
  const lastTotalVotersRef = useRef(0);
  useEffect(() => {
    if (createdQuestion?.id) {
      const unsubscribe = firestore.getVotesStats(createdQuestion.id, (stats, totalVoters) => {
        if (totalVoters > lastTotalVotersRef.current) {
          playVoteSubmitted();
        }
        lastTotalVotersRef.current = totalVoters;
        setVotesStats(stats);
      });
      return () => unsubscribe();
    }
  }, [createdQuestion?.id, playVoteSubmitted]);

  const createQuestion = useMutation({
    mutationFn: async () => {
      // 是非題、簡答題自動鎖定 options，老師不用填
      const finalOptions =
        questionType === "truefalse"
          ? firestore.TRUEFALSE_OPTIONS
          : questionType === "shortanswer"
            ? firestore.SHORTANSWER_PLACEHOLDER_OPTIONS
            : options.map((o) => o.value).filter(Boolean);
      return await firestore.createQuestion(imageUrl, finalOptions, { requireIdentity, questionType });
    },
    onSuccess: (question) => {
      setCreatedQuestion(question);
      playVoteSessionStart();
      // 建立題目不另外通知 Google Chat，由後端每日彙整（dailyVoteDigest）統計
      const isAnon = !!auth.currentUser?.isAnonymous;
      toast({
        title: "成功建立問題",
        description: isAnon
          ? "學生現在可以開始投票了｜用 Google 登入，題目會存進題庫，換電腦也找得到"
          : "學生現在可以開始投票了",
        variant: "success",
      });
    },
    onError: (error: Error) => {
      reportServiceEvent({
        status: "failed",
        title: "題目建立失敗",
        context: "teacher.createQuestion",
        progress: "建立題目流程失敗",
        message: error.message,
        details: errorDetails(error),
      });
      toast({
        title: "建立問題失敗",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  const setCorrectAnswer = useMutation({
    mutationFn: async (correctAnswer: number) => {
      if (!createdQuestion) throw new Error("No question created");
      await firestore.setCorrectAnswer(createdQuestion.id, correctAnswer);
    },
    onSuccess: (_, correctAnswer) => {
      toast({
        title: "正確答案已設定",
        description: `選項 ${correctAnswer + 1} 已設為正確答案`,
      });
    },
    onError: (error: Error) => {
      toast({
        title: "設定失敗",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  // 多選題：toggle 某選項加入/移出正解集合
  const toggleMultiCorrect = useMutation({
    mutationFn: async (index: number) => {
      if (!createdQuestion) throw new Error("No question created");
      const current: number[] = Array.isArray(createdQuestion.correctAnswers)
        ? createdQuestion.correctAnswers
        : [];
      const next = current.includes(index)
        ? current.filter((i) => i !== index)
        : [...current, index];
      await firestore.setCorrectAnswers(createdQuestion.id, next);
    },
    onError: (err: Error) => toast({ title: "設定失敗", description: err.message, variant: "destructive" }),
  });

  const toggleShowAnswer = useMutation({
    mutationFn: async (show: boolean) => {
      if (!createdQuestion) throw new Error("No question created");
      await firestore.toggleShowAnswer(createdQuestion.id, show);
    },
    onSuccess: (_, show) => {
      toast({
        title: show ? "正確答案已顯示" : "正確答案已隱藏",
        description: show
          ? "學生現在可以看到正確答案"
          : "正確答案已從投票結果中隱藏",
      });
    },
    onError: (error: Error) => {
      toast({
        title: "操作失敗",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  const resetVotes = useMutation({
    mutationFn: async () => {
      if (!createdQuestion) throw new Error("No question created");
      await firestore.resetVotes(createdQuestion.id);
    },
    onSuccess: () => {
      setVotesStats({});
      toast({
        title: "投票已重置",
        description: "所有投票記錄已清除",
      });
    },
    onError: (error: Error) => {
      toast({
        title: "重置失敗",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  const resetAll = async () => {
    if (createdQuestion?.id) {
      await firestore.deactivateQuestion(createdQuestion.id);
    }
    setImageUrl("");
    setOptions([
      { id: newOptionId(), value: "" },
      { id: newOptionId(), value: "" },
      { id: newOptionId(), value: "" },
    ]);
    setCreatedQuestion(null);
    setWizardStep(1);
    setVotesStats({});
    toast({
      title: "已重置所有設定",
      description: "您可以重新開始建立新的投票",
    });
  };

  const addOption = () => setOptions([...options, { id: newOptionId(), value: "" }]);
  const removeOptionById = (id: string) => {
    setOptions(options.filter((o) => o.id !== id));
  };
  const updateOptionById = (id: string, value: string) => {
    setOptions(options.map((o) => (o.id === id ? { ...o, value } : o)));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const validOptions = options.filter(Boolean);

    if (!imageUrl) {
      toast({
        title: "缺少圖片",
        description: "請先上傳或截取圖片",
        variant: "destructive",
      });
      return;
    }

    if (validOptions.length < 2) {
      toast({
        title: "選項不足",
        description: "請至少填寫兩個選項",
        variant: "destructive",
      });
      return;
    }

    await createQuestion.mutateAsync();
  };

  const handleImageSelect = async (image: string) => {
    if (image.startsWith("GALLERY::")) {
      setImageUrl(image);
      return;
    }
    try {
      // 1) 先壓縮到 700KB 內（保險，避免 Storage 上傳超大檔）
      const compressed = await compressImageToFit(image);
      if (compressed.didCompress) {
        const beforeKB = (compressed.originalBytes / 1024).toFixed(0);
        const afterKB = (compressed.finalBytes / 1024).toFixed(0);
        toast({
          title: "圖片已自動壓縮",
          description: `${beforeKB} KB → ${afterKB} KB`,
          variant: "success",
        });
      }
      // 2) 大圖丟 Storage（< 50KB 保留 inline 省 RTT）
      const finalUrl = await uploadImageIfLarge(compressed.dataUrl);
      setImageUrl(finalUrl);
    } catch (err: any) {
      reportServiceEvent({
        status: "failed",
        title: "圖片處理失敗",
        context: "teacher.handleImageSelect",
        progress: "圖片壓縮或上傳失敗",
        message: err?.message ?? "圖片處理失敗",
        details: errorDetails(err),
      });
      toast({
        title: "圖片處理失敗",
        description: err?.message ?? "請再試一次",
        variant: "destructive",
      });
    }
  };

  const validOptionCount = options.filter((o) => o.value.trim()).length;
  const optionsRequired = questionType === "single" || questionType === "multiple";
  const canSubmit = !!imageUrl && (!optionsRequired || validOptionCount >= 2);

  return (
    <div className="playful-shell">
      <div className="page-container max-w-[min(1320px,94vw)]">
      {/* Playful 玻璃感頂列：logo + 品牌 + 連續打卡 chip */}
      <header className="playful-topbar -mx-6 px-4 sm:px-6 py-3 mb-6 flex items-center justify-between gap-3 rounded-none">
        <a href="https://www.smes.tyc.edu.tw/" target="_blank" rel="noopener noreferrer"
          className="flex items-center gap-3 group">
          <img
            src={`${import.meta.env.BASE_URL}logo.png`}
            alt="Logo"
            className="h-10 sm:h-11 w-auto object-contain transition-transform duration-300 group-hover:scale-110 group-hover:rotate-3"
          />
          <div className="leading-tight">
            <div className="text-base sm:text-lg font-extrabold text-slate-900">即時投票系統</div>
            <div className="text-xs text-slate-500 hidden sm:block">讓每個聲音都被聽見 ✨</div>
          </div>
        </a>

        <div className="flex items-center gap-2 flex-wrap justify-end">
          {currentUser && !currentUser.isAnonymous ? (
            <motion.div
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              className="flex items-center gap-2"
            >
              <div
                className="hidden sm:flex items-center gap-2 px-3 py-1.5 rounded-full bg-white shadow-sm border border-slate-200"
                title={currentUser.email ?? ""}
              >
                {currentUser.photoURL ? (
                  <img
                    src={currentUser.photoURL}
                    alt=""
                    referrerPolicy="no-referrer"
                    className="w-6 h-6 rounded-full ring-2 ring-white"
                  />
                ) : (
                  <UserCircle className="w-5 h-5 text-blue-600" />
                )}
                <span className="text-xs font-bold text-slate-800 max-w-[120px] truncate">
                  {currentUser.displayName ?? currentUser.email?.split("@")[0] ?? "已登入"}
                </span>
              </div>
              <Link href="/dashboard">
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="h-9 gap-1.5 rounded-full bg-white shadow-sm hover:bg-blue-50 text-slate-700 font-bold"
                >
                  <LayoutGrid className="w-4 h-4" />題庫
                </Button>
              </Link>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={handleSignOut}
                className="h-9 px-2 text-slate-400 hover:text-red-600 hover:bg-red-50 rounded-full"
                title="登出"
              >
                <LogOut className="w-4 h-4" />
              </Button>
            </motion.div>
          ) : (
            <>
              <span className="hidden md:inline text-xs text-amber-700 bg-amber-50 border border-amber-200 px-2 py-1 rounded-full font-bold">
                匿名模式
              </span>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={handleGoogleSignIn}
                className="h-9 gap-1.5 rounded-full bg-white shadow-sm hover:bg-blue-50 text-slate-700 font-bold border border-slate-200"
              >
                <LogIn className="w-3.5 h-3.5" />Google 登入
              </Button>
            </>
          )}
        </div>
      </header>

      {!createdQuestion ? (
        <form onSubmit={handleSubmit} className="space-y-6">
          {/* Playful Hero 問候卡 */}
          <div className="playful-card p-6 sm:p-8 flex items-center justify-between gap-4 overflow-hidden">
            <div className="min-w-0">
              <div className="text-sm text-blue-700 font-extrabold mb-2">👋 嗨，老師！</div>
              <h1 className="text-2xl sm:text-3xl lg:text-4xl font-extrabold text-slate-900 leading-tight tracking-tight">
                今天想問學生<br className="hidden sm:block" />什麼問題呢？
              </h1>
              <div className="flex gap-2 mt-4 flex-wrap">
                <span className="playful-stat-chip">📊 即時計票</span>
                <span className="playful-stat-chip">⚡ QR 一掃即投</span>
                <span className="playful-stat-chip">⭐ 答對立即慶祝</span>
              </div>
            </div>
            {/* 裝飾圖形：黃方塊 + 藍方塊 + 粉紅圓 */}
            <div className="relative w-24 h-24 sm:w-28 sm:h-28 lg:w-36 lg:h-36 flex-shrink-0 hidden sm:block" aria-hidden>
              <div className="absolute top-0 left-0 w-12 h-12 lg:w-16 lg:h-16 rounded-2xl bg-amber-400" />
              <div className="absolute bottom-0 right-0 w-12 h-12 lg:w-16 lg:h-16 rounded-2xl bg-blue-500" />
              <div className="absolute top-5 right-5 lg:top-7 lg:right-7 w-12 h-12 lg:w-16 lg:h-16 rounded-full bg-pink-400" />
            </div>
          </div>

          {/* 模式切換 bar */}
          <div className="flex items-center justify-between gap-2 text-xs flex-wrap">
            <div className="text-slate-500">
              {formMode === "wizard" ? "💡 新手引導模式：分 3 步建題" : "⚡ 快速模式：所有設定一次填完"}
            </div>
            <div className="flex items-center gap-1 bg-slate-100 rounded-full p-0.5">
              <button
                type="button"
                onClick={() => switchFormMode("wizard")}
                className={`px-3 py-1 rounded-full text-xs font-medium transition-all ${
                  formMode === "wizard" ? "bg-white text-blue-700 shadow-sm" : "text-slate-500"
                }`}
              >
                <Wand2 className="w-3 h-3 inline mr-1" />引導
              </button>
              <button
                type="button"
                onClick={() => switchFormMode("quick")}
                className={`px-3 py-1 rounded-full text-xs font-medium transition-all ${
                  formMode === "quick" ? "bg-white text-blue-700 shadow-sm" : "text-slate-500"
                }`}
              >
                <Rocket className="w-3 h-3 inline mr-1" />快速
              </button>
            </div>
          </div>

          {/* Wizard 進度條 */}
          {formMode === "wizard" && (
            <div className="flex items-center gap-2">
              {[1, 2, 3].map((s, i) => (
                <div key={s} className="flex items-center gap-2 flex-1">
                  <div className={`flex-shrink-0 w-8 h-8 rounded-full flex items-center justify-center font-bold text-sm transition-all ${
                    wizardStep > s ? "bg-green-500 text-white" :
                    wizardStep === s ? "bg-blue-600 text-white scale-110 shadow-md" :
                    "bg-slate-200 text-slate-400"
                  }`}>
                    {wizardStep > s ? <CheckCircle2 className="w-4 h-4" /> : s}
                  </div>
                  <div className="text-xs flex-1 hidden sm:block">
                    <div className={wizardStep === s ? "font-semibold text-blue-700" : "text-slate-500"}>
                      {s === 1 ? "選題型 + 上傳圖片" : s === 2 ? "設定選項" : "確認後建立"}
                    </div>
                  </div>
                  {i < 2 && <div className={`hidden sm:block flex-1 h-0.5 transition-colors ${wizardStep > s ? "bg-green-400" : "bg-slate-200"}`} />}
                </div>
              ))}
            </div>
          )}

          {(formMode === "quick" || wizardStep === 1) && (
          <>
          {globalActiveQuestion && (
            <motion.div
              initial={{ opacity: 0, y: -10 }}
              animate={{ opacity: 1, y: 0 }}
              className="bg-blue-50 border border-blue-200 p-4 rounded-lg flex items-center justify-between gap-4 shadow-sm"
            >
              <div className="flex items-center gap-3">
                <div className="p-2 bg-blue-100 rounded-full">
                  <Eye className="w-5 h-5 text-blue-600" />
                </div>
                <div>
                  <p className="text-sm font-semibold text-blue-800">目前有一個進行中的投票</p>
                  <p className="text-xs text-blue-600">您可以繼續管理它，或直接建立新問題（舊問題將自動停用）</p>
                </div>
              </div>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => setCreatedQuestion(globalActiveQuestion)}
                className="bg-white hover:bg-blue-100 border-blue-200 text-blue-700 whitespace-nowrap"
              >
                查看目前結果
              </Button>
            </motion.div>
          )}
          <ScreenshotUpload onImageSelect={handleImageSelect} />

          {/* wizard step 1 也要先讓老師選題型，這樣 step 2 才知道要不要顯示選項 */}
          {formMode === "wizard" && (
            <Card className="p-4 sm:p-6 rounded-3xl border-0 shadow-[0_4px_20px_rgba(15,23,42,0.04)]">
              <p className="text-sm font-extrabold text-slate-900 mb-3">選擇題型</p>
              <PlayfulTypeRow questionType={questionType} setQuestionType={setQuestionType} />

              {/* 各題型說明卡 — 點選後立即視覺回饋 */}
              <motion.div
                key={questionType}
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.25 }}
                className="mt-4"
              >
                {questionType === "single" && (
                  <div className="p-4 bg-gradient-to-r from-blue-50 to-sky-50 border border-blue-200 rounded-lg space-y-2">
                    <p className="text-sm font-semibold text-blue-900 flex items-center gap-1.5">
                      <Circle className="w-4 h-4" />單選題
                    </p>
                    <ul className="text-xs text-blue-800/90 space-y-1 list-disc list-inside">
                      <li>下一步可填 2 個以上選項，學生只能選一個</li>
                      <li>適合：常識問答、閱讀測驗、多選一</li>
                      <li>學生點選即送出，不能改</li>
                    </ul>
                  </div>
                )}
                {questionType === "multiple" && (
                  <div className="p-4 bg-gradient-to-r from-purple-50 to-fuchsia-50 border border-purple-200 rounded-lg space-y-2">
                    <p className="text-sm font-semibold text-purple-900 flex items-center gap-1.5">
                      <CheckSquare className="w-4 h-4" />多選題
                    </p>
                    <ul className="text-xs text-purple-800/90 space-y-1 list-disc list-inside">
                      <li>下一步可填 2 個以上選項，學生可勾多個再送出</li>
                      <li>適合：哪些原因 / 列出所有正確答案</li>
                      <li>正解可設多個，全選對才算對</li>
                    </ul>
                  </div>
                )}
                {questionType === "truefalse" && (
                  <div className="p-4 bg-gradient-to-r from-amber-50 to-orange-50 border border-amber-200 rounded-lg space-y-2">
                    <p className="text-sm font-semibold text-amber-900">⚡ 是非題（自動使用以下兩個選項）</p>
                    <p className="text-xs text-amber-800/90">不用填選項，下一步直接到具名設定。學生看到的是：</p>
                    <div className="flex gap-3">
                      <div className="flex-1 bg-white rounded-md py-3 text-center font-bold text-2xl border-2 border-green-300">⭕ 是</div>
                      <div className="flex-1 bg-white rounded-md py-3 text-center font-bold text-2xl border-2 border-red-300">❌ 否</div>
                    </div>
                  </div>
                )}
                {questionType === "shortanswer" && (
                  <div className="p-4 bg-gradient-to-r from-purple-50 to-pink-50 border border-purple-200 rounded-lg space-y-2">
                    <p className="text-sm font-semibold text-purple-900">💬 簡答題</p>
                    <ul className="text-xs text-purple-800/90 space-y-1 list-disc list-inside">
                      <li>不用填選項，學生會看到文字輸入框（最多 {firestore.SHORTANSWER_MAX_LENGTH} 字）</li>
                      <li>老師端與課堂模式即時顯示 <strong>文字雲</strong>，相同答案合併、出現越多字級越大</li>
                      <li>適合：腦力激盪、收集回饋、單字接龍</li>
                    </ul>
                  </div>
                )}
              </motion.div>
            </Card>
          )}
          </>
          )}

          {(formMode === "quick" || wizardStep === 2) && (
          <Card className="p-6 rounded-3xl border-0 shadow-[0_4px_20px_rgba(15,23,42,0.04)]">
            <div className="flex items-center justify-between mb-4 flex-wrap gap-2">
              <h2 className="text-base font-extrabold flex items-center gap-2 text-slate-900">
                🎲 選項設置
                {(questionType === "single" || questionType === "multiple") && (
                  <span className="text-xs text-slate-400 font-normal">共 {options.length} 個</span>
                )}
              </h2>
              {(questionType === "single" || questionType === "multiple") && options.length >= 3 && (
                <span className="text-xs text-slate-500 flex items-center gap-1">
                  <GripVertical className="w-3 h-3" />可拖曳排序
                </span>
              )}
            </div>

            {/* 題型切換（4 種）— wizard 模式 step 1 已選過，不再顯示避免視覺重複 */}
            {formMode === "quick" && (
              <div className="mb-4">
                <PlayfulTypeRow questionType={questionType} setQuestionType={setQuestionType} />
              </div>
            )}

            {questionType === "truefalse" && (
              <div className="mb-4 p-4 bg-gradient-to-r from-amber-50 to-orange-50 border border-amber-200 rounded-lg">
                <p className="text-sm text-amber-900 font-medium mb-2">是非題會自動使用兩個選項：</p>
                <div className="flex gap-3">
                  <div className="flex-1 bg-white rounded-md py-3 text-center font-bold text-2xl border-2 border-green-300">
                    ⭕ 是
                  </div>
                  <div className="flex-1 bg-white rounded-md py-3 text-center font-bold text-2xl border-2 border-red-300">
                    ❌ 否
                  </div>
                </div>
              </div>
            )}

            {questionType === "shortanswer" && (
              <div className="mb-4 p-4 bg-gradient-to-r from-purple-50 to-pink-50 border border-purple-200 rounded-lg">
                <p className="text-sm text-purple-900 font-medium mb-2">💬 簡答題：學生會看到文字輸入框</p>
                <ul className="text-xs text-purple-800/90 space-y-1 list-disc list-inside">
                  <li>每位學生最多輸入 {firestore.SHORTANSWER_MAX_LENGTH} 字</li>
                  <li>老師端與課堂模式即時顯示 <strong>文字雲</strong>，相同答案合併、出現越多字級越大</li>
                  <li>適合：腦力激盪、收集回饋、單字接龍</li>
                </ul>
              </div>
            )}

            <div className={questionType === "truefalse" || questionType === "shortanswer" ? "opacity-40 pointer-events-none" : ""}>
              <Reorder.Group
                axis="y"
                values={options}
                onReorder={setOptions}
                className="flex flex-col gap-2.5"
              >
                {options.map((opt, index) => {
                  const palette = OPT_PALETTES[index % OPT_PALETTES.length];
                  return (
                  <Reorder.Item
                    key={opt.id}
                    value={opt}
                    className="flex items-center gap-2 rounded-2xl cursor-default p-2"
                    style={{ background: palette.bg }}
                    whileDrag={{ scale: 1.02, boxShadow: "0 8px 24px rgba(59,130,246,0.25)", zIndex: 10 }}
                  >
                    <button
                      type="button"
                      className="cursor-grab active:cursor-grabbing text-white/70 hover:text-white transition-colors flex-shrink-0 p-1 rounded-md"
                      aria-label="拖曳排序"
                      onPointerDown={(e) => e.currentTarget.setPointerCapture(e.pointerId)}
                      style={{ color: palette.dot }}
                    >
                      <GripVertical className="w-4 h-4" />
                    </button>
                    <span
                      className="playful-letter w-9 h-9 text-sm"
                      style={{ background: palette.dot }}
                      aria-hidden
                    >
                      {String.fromCharCode(65 + index)}
                    </span>
                    <Input
                      value={opt.value}
                      onChange={(e) => updateOptionById(opt.id, e.target.value)}
                      placeholder={`選項 ${index + 1}`}
                      className="bg-white border-0 rounded-xl h-11 font-semibold text-slate-900 focus-visible:ring-2 focus-visible:ring-blue-500/30 focus-visible:ring-offset-0 placeholder:text-slate-400 placeholder:font-normal"
                    />
                    {options.length > 2 && (
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        onClick={() => removeOptionById(opt.id)}
                        className="bg-white/70 hover:bg-white text-slate-500 hover:text-red-600 rounded-xl h-9 w-9 flex-shrink-0"
                        title="刪除此選項"
                      >
                        <Minus className="h-4 w-4" />
                      </Button>
                    )}
                  </Reorder.Item>
                  );
                })}
              </Reorder.Group>
            </div>

            <div className="mt-3">
              <Button
                type="button"
                variant="ghost"
                onClick={addOption}
                disabled={questionType === "truefalse" || questionType === "shortanswer"}
                className="w-full h-12 border-2 border-dashed border-slate-300 bg-white text-slate-500 hover:bg-slate-50 hover:border-slate-400 rounded-2xl font-extrabold disabled:opacity-40"
              >
                <Plus className="h-4 w-4 mr-1" />
                多加一個選項
              </Button>
            </div>

            <label className="mt-5 flex items-start gap-3 p-3 rounded-lg border border-dashed border-blue-200 bg-blue-50/40 hover:bg-blue-50 cursor-pointer transition-colors">
              <input
                type="checkbox"
                checked={requireIdentity}
                onChange={(e) => setRequireIdentity(e.target.checked)}
                className="mt-0.5 w-4 h-4 accent-blue-600"
              />
              <div className="flex-1">
                <div className="flex items-center gap-1.5 text-sm font-semibold text-blue-900">
                  <UserCheck className="w-4 h-4" />需要學生具名才能投票
                </div>
                <div className="text-xs text-blue-700/80 mt-0.5">
                  學生第一次投票要填姓名+座號（會記住下次自動帶入）。適合形成性評量、補救教學追蹤
                </div>
              </div>
            </label>
          </Card>
          )}

          {/* wizard step 3：摘要預覽 */}
          {formMode === "wizard" && wizardStep === 3 && (
            <Card className="p-6 bg-gradient-to-br from-emerald-50 to-blue-50 border-emerald-200">
              <h3 className="text-lg font-bold text-emerald-900 mb-4 flex items-center gap-2">
                <CheckCircle2 className="w-5 h-5" />準備建立 — 確認以下設定
              </h3>
              <div className="grid sm:grid-cols-2 gap-4">
                <div className="space-y-2">
                  <div className="text-xs text-slate-500">題目圖片</div>
                  {imageUrl ? (
                    <TeacherImageDisplay imageUrl={imageUrl} />
                  ) : (
                    <div className="text-sm text-red-600">⚠️ 還沒上傳圖片，請回 step 1</div>
                  )}
                </div>
                <div className="space-y-3 text-sm">
                  <div>
                    <span className="text-slate-500">題型：</span>
                    <span className="font-semibold text-slate-800 ml-1">
                      {questionType === "single" ? "◯ 單選題" : questionType === "multiple" ? "☑️ 多選題" : questionType === "truefalse" ? "⚡ 是非題" : "💬 簡答題"}
                    </span>
                  </div>
                  <div>
                    <span className="text-slate-500">具名：</span>
                    <span className="font-semibold ml-1">{requireIdentity ? "✅ 需要學生填姓名" : "❌ 匿名投票"}</span>
                  </div>
                  {questionType === "single" || questionType === "multiple" ? (
                    <div>
                      <span className="text-slate-500">選項（{validOptionCount} 個）：</span>
                      <ol className="list-decimal list-inside mt-1 space-y-0.5 text-slate-700">
                        {options.filter((o) => o.value.trim()).map((o, i) => (
                          <li key={o.id}>{o.value}</li>
                        ))}
                      </ol>
                    </div>
                  ) : (
                    <div className="text-slate-600 text-xs">{questionType ===
