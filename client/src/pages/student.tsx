import { useState, useEffect, useRef } from "react";
import { useMutation } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { useToast } from "@/hooks/use-toast";
import * as firestore from "@/lib/firestore-voting";
import { auth } from "@/lib/firebase";
import { onAuthStateChanged } from "firebase/auth";
import { useParams } from "wouter";
import { motion, AnimatePresence } from "framer-motion";
import { CheckCircle2, ChevronLeft, ChevronRight } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { ReactionBar } from "@/components/reaction-bar";
import { useConfetti } from "@/hooks/use-confetti";
import { useVotingSound } from "@/hooks/use-voting-sounds";
import { errorDetails, reportServiceEvent } from "@/lib/telemetry";

interface GalleryItem {
  letter: string;
  name: string;
  url: string;
}

const BADGE_COLORS = [
  "#EF4444", "#3B82F6", "#F59E0B", "#10B981", "#8B5CF6",
  "#F97316", "#EC4899", "#14B8A6", "#6366F1", "#84CC16",
];

function parseGallery(imageUrl: string | undefined): GalleryItem[] {
  if (!imageUrl) return [];
  if (imageUrl.startsWith("GALLERY::")) {
    try {
      const parsed = JSON.parse(imageUrl.slice("GALLERY::".length));
      if (Array.isArray(parsed)) return parsed;
    } catch {
      return [];
    }
  }
  return [{ letter: "", name: "", url: imageUrl }];
}

export default function Student() {
  const { toast } = useToast();
  const params = useParams<{ id: string }>();
  const questionId = params.id;
  const [question, setQuestion] = useState<any | null>(null);
  const [notFound, setNotFound] = useState(false);
  const [hasVoted, setHasVoted] = useState(false);
  const [showSuccessOverlay, setShowSuccessOverlay] = useState(false);
  const [activeSlide, setActiveSlide] = useState(0);
  const sliderRef = useRef<HTMLDivElement>(null);
  const { triggerConfetti } = useConfetti();
  const { playVoteSubmitted } = useVotingSound();
  const [selectedOption, setSelectedOption] = useState<number | null>(null);
  const [animatedCounts, setAnimatedCounts] = useState<Record<number, number>>({});
  const [totals, setTotals] = useState<Record<number, number>>({});
  const [totalVotes, setTotalVotes] = useState(0);

  useEffect(() => {
    let unsubQ: (() => void) | undefined;
    let unsubV: (() => void) | undefined;
    let started = false;

    const startSubscriptions = () => {
      if (started) return;
      started = true;
      if (questionId) {
        unsubQ = firestore.listenToQuestion(questionId, (q) => {
          if (q) {
            setQuestion(q);
            setNotFound(false);
          } else {
            setNotFound(true);
          }
        });
        unsubV = firestore.getVotesStats(questionId, (stats, totalVoters) => {
          setTotals(stats);
          setTotalVotes(totalVoters);
        });
      } else {
        unsubQ = firestore.getActiveQuestion((q) => {
          setQuestion(q);
        });
      }
    };

    if (auth.currentUser) startSubscriptions();
    const unsubAuth = onAuthStateChanged(auth, (user) => {
      if (user) startSubscriptions();
    });

    return () => {
      unsubAuth();
      unsubQ?.();
      unsubV?.();
    };
  }, [questionId]);

  useEffect(() => {
    if (question?.id) {
      const voted = localStorage.getItem(`voted_${question.id}`);
      if (voted) {
        setHasVoted(true);
        setSelectedOption(parseInt(voted));
      } else {
        setHasVoted(false);
        setSelectedOption(null);
      }
    }
  }, [question?.id]);

  useEffect(() => {
    if (hasVoted) {
      Object.entries(totals).forEach(([optionIndex, count]) => {
        const startValue = animatedCounts[Number(optionIndex)] || 0;
        const steps = 10;
        const increment = (count - startValue) / steps;
        let currentStep = 0;

        const interval = setInterval(() => {
          if (currentStep < steps) {
            setAnimatedCounts((prev) => ({
              ...prev,
              [Number(optionIndex)]: Math.round(startValue + increment * currentStep),
            }));
            currentStep++;
          } else {
            clearInterval(interval);
            setAnimatedCounts((prev) => ({
              ...prev,
              [Number(optionIndex)]: count,
            }));
          }
        }, 50);

        return () => clearInterval(interval);
      });
    }
  }, [totals, hasVoted]);

  const isExpired = firestore.isQuestionExpired(question);
  const requireIdentity: boolean = !!question?.requireIdentity;

  const [secondsLeft, setSecondsLeft] = useState<number | null>(null);
  useEffect(() => {
    if (!question?.votingEndsAt) {
      setSecondsLeft(null);
      return;
    }
    const tick = () => {
      const ms = question.votingEndsAt.toMillis() - Date.now();
      setSecondsLeft(Math.max(0, Math.ceil(ms / 1000)));
    };
    tick();
    const t = window.setInterval(tick, 250);
    return () => window.clearInterval(t);
  }, [question?.votingEndsAt]);
  const isTimeUp = secondsLeft !== null && secondsLeft <= 0;

  const [committedName, setCommittedName] = useState<string>(() => localStorage.getItem("voter_name") || "");
  const [nameInput, setNameInput] = useState<string>(() => localStorage.getItem("voter_name") || "");
  const hasIdentity = !!committedName.trim();

  const isMultiple = question?.questionType === "multiple";
  const isTrueFalse = question?.questionType === "truefalse";
  const isShortAnswer = question?.questionType === "shortanswer";
  const [textAnswer, setTextAnswer] = useState("");
  const [multiSelection, setMultiSelection] = useState<Set<number>>(new Set());
  const toggleMulti = (idx: number) => {
    setMultiSelection((prev) => {
      const next = new Set(prev);
      if (next.has(idx)) next.delete(idx);
      else next.add(idx);
      return next;
    });
  };

  const vote = useMutation({
    mutationFn: async (selection: firestore.VoteSelection) => {
      if (!question) return;
      if (isExpired) throw new Error("此題投票已結束");
      if (isTimeUp) throw new Error("倒數結束，無法投票");
      if (requireIdentity && !hasIdentity) throw new Error("請先填寫姓名");
      await firestore.addVote(question.id, selection, requireIdentity ? { name: committedName } : undefined);
    },
    onSuccess: (_, selection) => {
      triggerConfetti();
      try { playVoteSubmitted(); } catch { /* ignore */ }
      setShowSuccessOverlay(true);
      window.setTimeout(() => setShowSuccessOverlay(false), 1800);

      toast({ title: "🎉 投票成功", description: "感謝您的參與！", variant: "success" });
      setHasVoted(true);
      let repIdx: number | null = null;
      let stored = "voted";
      if (typeof selection === "number") {
        repIdx = selection;
        stored = String(selection);
      } else if (Array.isArray(selection)) {
        repIdx = selection[0] ?? null;
        stored = selection.join(",");
      } else if (selection && typeof selection === "object" && "text" in selection) {
        stored = `text:${selection.text}`;
      }
      setSelectedOption(repIdx);
      if (question?.id) localStorage.setItem(`voted_${question.id}`, stored);
    },
    onError: (error: any) => {
      if (firestore.isExpectedVoteRejection(error)) {
        if (error.code === firestore.VOTE_ALREADY_VOTED) setHasVoted(true);
        toast({
          title: error.code === firestore.VOTE_ALREADY_VOTED ? "已經投過票囉" : "投票已結束",
          description: error.message,
          variant: "destructive",
        });
        return;
      }
      reportServiceEvent({
        status: "failed",
        title: "學生投票失敗",
        context: "student.vote",
        progress: "投票寫入或驗證失敗",
        message: error.message || "投票失敗",
        details: { ...errorDetails(error), questionId: question?.id },
      });
      toast({ title: "投票失敗", description: error.message || "請重試", variant: "destructive" });
    },
  });

  const gallery = parseGallery(question?.imageUrl);

  const scrollToSlide = (index: number) => {
    if (!sliderRef.current) return;
    const width = sliderRef.current.clientWidth;
    sliderRef.current.scrollTo({ left: index * width, behavior: "smooth" });
    setActiveSlide(index);
  };

  const handleScroll = () => {
    if (!sliderRef.current) return;
    const width = sliderRef.current.clientWidth;
    if (width > 0) {
      const idx = Math.round(sliderRef.current.scrollLeft / width);
      setActiveSlide(idx);
    }
  };

  if (!question) {
    if (questionId && notFound) {
      return (
        <div className="page-container text-center">
          <div className="text-7xl">🔎</div>
          <h1 className="text-2xl font-bold gradient-text">找不到這個題目</h1>
          <p className="text-muted-foreground">請重新掃描 QR Code</p>
        </div>
      );
    }
    return (
      <div className="page-container text-center">
        <h1 className="text-2xl font-bold gradient-text">There are currently no active questions</h1>
        <p className="text-muted-foreground mt-2">Please wait for the host to create a new poll.</p>
      </div>
    );
  }

  if (isExpired && !hasVoted) {
    return (
      <div className="page-container text-center">
        <h1 className="text-2xl font-bold gradient-text">此題投票已結束</h1>
      </div>
    );
  }

  if (isTimeUp && !hasVoted) {
    return (
      <div className="page-container text-center space-y-3">
        <div className="text-7xl">⏰</div>
        <h1 className="text-2xl font-bold text-amber-600">倒數結束</h1>
      </div>
    );
  }

  if (requireIdentity && !hasIdentity) {
    const submitIdentity = (e: React.FormEvent) => {
      e.preventDefault();
      const n = nameInput.trim();
      if (!n) return;
      localStorage.setItem("voter_name", n);
      setCommittedName(n);
    };

    return (
      <div className="page-container max-w-md">
        <Card className="p-8 space-y-5">
          <div className="text-center space-y-2">
            <div className="text-5xl">📝</div>
            <h1 className="text-xl font-bold gradient-text">請先輸入姓名</h1>
          </div>
          <form onSubmit={submitIdentity} className="space-y-3">
            <input
              type="text"
              placeholder="例：小華"
              value={nameInput}
              onChange={(e) => setNameInput(e.target.value)}
              maxLength={30}
              autoFocus
              className="w-full h-11 px-3 rounded-md border border-gray-300 text-base"
            />
            <Button type="submit" size="lg" className="w-full" disabled={!nameInput.trim()}>
              確認進入投票
            </Button>
          </form>
        </Card>
      </div>
    );
  }

  const maxVotes = Math.max(...Object.values(totals), 0);
  const OPT_PALETTES = [
    { bg: "#FEE2E2", dot: "#EF4444" },
    { bg: "#DBEAFE", dot: "#3B82F6" },
    { bg: "#FEF3C7", dot: "#F59E0B" },
    { bg: "#D1FAE5", dot: "#10B981" },
    { bg: "#EDE9FE", dot: "#8B5CF6" },
    { bg: "#FCE7F3", dot: "#F472B6" },
  ];

  return (
    <div className="playful-shell min-h-screen p-2 sm:p-4">
      <AnimatePresence>
        {showSuccessOverlay && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-[9998] flex items-center justify-center pointer-events-none"
          >
            <div className="bg-white/95 rounded-3xl shadow-2xl px-8 py-6 flex flex-col items-center gap-3 border-4 border-green-400">
              <div className="text-7xl">🎉</div>
              <div className="text-2xl font-black text-green-700">投票成功！</div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      <div className="max-w-2xl mx-auto relative z-10">
        <div className="flex items-center gap-2 mb-3 px-1">
          <img src={`${import.meta.env.BASE_URL}logo.png`} alt="" className="w-8 h-8 rounded-md" />
          <div className="flex-1 leading-tight">
            <div className="text-sm sm:text-base font-extrabold text-slate-900">Real-time Voting System</div>
            <div className="text-xs text-slate-500">{committedName ? `${committedName}` : " Welcome！"}</div>
          </div>
          <span className="inline-flex items-center gap-1 text-xs px-2 py-1 bg-red-100 text-red-600 rounded-full font-extrabold">
            <span className="w-1.5 h-1.5 rounded-full bg-red-600 animate-playful-pulse" />LIVE
          </span>
        </div>

        <Card className="overflow-hidden shadow-xl border-0 bg-white/95 backdrop-blur-sm rounded-3xl">
          {/* Swipeable 1-by-1 Photo Carousel */}
          {gallery.length > 0 && (
            <div className="relative bg-slate-950">
              <div
                ref={sliderRef}
                onScroll={handleScroll}
                className="flex overflow-x-auto snap-x snap-mandatory scroll-smooth"
                style={{ scrollbarWidth: "none" }}
              >
                {gallery.map((item, idx) => (
                  <div
                    key={idx}
                    className="w-full flex-shrink-0 snap-center relative flex flex-col items-center justify-center bg-slate-950"
                  >
                    <img
                      src={item.url}
                      alt={item.name || `照片 ${idx + 1}`}
                      className="w-full h-[55vh] max-h-[480px] object-contain"
                    />
                    {item.letter && (
                      <div className="w-full bg-slate-900/95 px-4 py-3 flex items-center gap-3">
                        <span
                          className="w-9 h-9 rounded-full flex items-center justify-center text-white font-black text-lg flex-shrink-0"
                          style={{ background: BADGE_COLORS[idx % BADGE_COLORS.length] }}
                        >
                          {item.letter}
                        </span>
                        <span className="text-white font-bold text-lg truncate flex-1">
                          {item.name}
                        </span>
                        <span className="text-slate-300 text-sm font-semibold">
                          {idx + 1} / {gallery.length}
                        </span>
                      </div>
                    )}
                  </div>
                ))}
              </div>

              {gallery.length > 1 && (
                <>
                  {activeSlide > 0 && (
                    <button
                      type="button"
                      onClick={() => scrollToSlide(activeSlide - 1)}
                      className="absolute left-2 top-[45%] -translate-y-1/2 bg-black/55 hover:bg-black/80 text-white p-2 rounded-full shadow-lg"
                      aria-label="上一張"
                    >
                      <ChevronLeft className="w-6 h-6" />
                    </button>
                  )}
                  {activeSlide < gallery.length - 1 && (
                    <button
                      type="button"
                      onClick={() => scrollToSlide(activeSlide + 1)}
                      className="absolute right-2 top-[45%] -translate-y-1/2 bg-black/55 hover:bg-black/80 text-white p-2 rounded-full shadow-lg"
                      aria-label="下一張"
                    >
                      <ChevronRight className="w-6 h-6" />
                    </button>
                  )}

                  {/* Swipe hint + dots */}
                  <div className="bg-slate-900 pb-3 pt-1 flex flex-col items-center gap-1.5">
                    <div className="flex items-center gap-1.5">
                      {gallery.map((_, idx) => (
                        <button
                          key={idx}
                          type="button"
                          onClick={() => scrollToSlide(idx)}
                          className={`h-2 rounded-full transition-all ${
                            idx === activeSlide ? "w-5 bg-white" : "w-2 bg-white/40"
                          }`}
                        />
                      ))}
                    </div>
                    <span className="text-[11px] text-slate-300">
                      👈 Swipe left to see the next 👉
                    </span>
                  </div>
                </>
              )}
            </div>
          )}

          <div className="p-4 sm:p-6 space-y-4 sm:space-y-6">
            <AnimatePresence mode="wait">
              {hasVoted ? (
                <motion.div className="space-y-4" initial={{ opacity: 0 }} animate={{ opacity: 1 }}>
                  <div className="text-center mb-4">
                    <h2 className="text-xl sm:text-2xl font-bold gradient-text mb-1">Voting Result</h2>
                    <p className="text-sm text-muted-foreground">Total Votes：{totalVotes} Vote</p>
                  </div>
                  {question.options.map((option: string, index: number) => {
                    const count = totals[index] || 0;
                    const percentage = totalVotes ? (count / totalVotes) * 100 : 0;
                    const isWinning = count === maxVotes && count > 0;
                    return (
                      <div key={index} className="bg-white rounded-lg border border-gray-200 p-4 shadow-sm">
                        <div className="flex items-center justify-between gap-3 mb-2">
                          <div className="flex items-center gap-3 min-w-0">
                            <span className="w-8 h-8 rounded-full bg-primary text-primary-foreground flex items-center justify-center text-sm font-bold flex-shrink-0">
                              {String.fromCharCode(65 + index)}
                            </span>
                            <span className={`font-bold ${isWinning ? "text-primary" : "text-gray-800"}`}>
                              {option} {isWinning && "🌟"}
                            </span>
                            {question.showAnswer && question.correctAnswer === index && (
                              <Badge className="bg-green-100 text-green-800">
                                <CheckCircle2 className="w-3 h-3 mr-1" />Winner
                              </Badge>
                            )}
                          </div>
                          <span className="font-bold text-base">
                            {animatedCounts[index] || 0} Vote ({percentage.toFixed(1)}%)
                          </span>
                        </div>
                        <div className="h-3 bg-gray-100 rounded-full overflow-hidden">
                          <div
                            className="h-full bg-primary rounded-full transition-all duration-500"
                            style={{ width: `${percentage}%` }}
                          />
                        </div>
                      </div>
                    );
                  })}
                </motion.div>
              ) : (
                <div className="space-y-4">
                  <div className="rounded-2xl p-4" style={{ background: "linear-gradient(135deg,#EFF6FF,#FCE7F3)" }}>
                    <h2 className="text-lg sm:text-xl font-extrabold text-slate-900">
                      {isShortAnswer ? "請輸入你的答案" : isMultiple ? "可複選後再送出" : "Please choose your favourite performance"}
                    </h2>
                    <p className="text-xs text-slate-500 mt-1">
                      {isMultiple ? `已選 ${multiSelection.size} 項` : "Cast your vote"}
                    </p>
                  </div>

                  {isShortAnswer ? (
                    <div className="space-y-3">
                      <textarea
                        value={textAnswer}
                        onChange={(e) => setTextAnswer(e.target.value.substring(0, firestore.SHORTANSWER_MAX_LENGTH))}
                        placeholder="輸入你的答案…"
                        rows={3}
                        className="w-full p-4 text-lg rounded-xl border-2 border-purple-200"
                      />
                      <Button
                        size="lg"
                        className="playful-cta w-full h-14 text-lg rounded-2xl"
                        disabled={vote.isPending || !textAnswer.trim()}
                        onClick={() => {
                          const trimmed = textAnswer.trim();
                          if (!trimmed || vote.isPending) return;
                          setHasVoted(true);
                          vote.mutate({ text: trimmed });
                        }}
                      >
                        💬 送出答案
                      </Button>
                    </div>
                  ) : (
                    <>
                      <div className={isTrueFalse ? "grid grid-cols-2 gap-3" : "flex flex-col gap-2.5"}>
                        {question.options.map((option: string, index: number) => {
                          const palette = OPT_PALETTES[index % OPT_PALETTES.length];
                          const isMultiSelected = isMultiple && multiSelection.has(index);
                          const isPicked = isMultiple ? isMultiSelected : selectedOption === index;

                          return (
                            <button
                              key={index}
                              type="button"
                              disabled={vote.isPending || hasVoted}
                              onClick={() => {
                                if (hasVoted || vote.isPending) return;
                                if (isMultiple) {
                                  toggleMulti(index);
                                  return;
                                }
                                setSelectedOption(index);
                                setHasVoted(true);
                                if (questionId) localStorage.setItem(`voted_${questionId}`, index.toString());
                                vote.mutate(index);
                              }}
                              className="w-full flex items-center gap-3 p-3.5 rounded-2xl border-2 transition-all text-left"
                              style={{
                                background: isPicked ? palette.bg : "#fff",
                                borderColor: isPicked ? palette.dot : "#E2E8F0",
                              }}
                            >
                              <span
                                className="w-10 h-10 text-base flex-shrink-0 flex items-center justify-center font-bold rounded-xl text-white"
                                style={{ background: palette.dot }}
                              >
                                {String.fromCharCode(65 + index)}
                              </span>
                              <span className="flex-1 text-base sm:text-lg font-extrabold text-slate-900">
                                {option}
                              </span>
                            </button>
                          );
                        })}
                      </div>

                      {isMultiple && !hasVoted && (
                        <Button
                          size="lg"
                          className="playful-cta w-full h-14 text-lg rounded-2xl"
                          disabled={vote.isPending || multiSelection.size === 0}
                          onClick={() => {
                            const arr = Array.from(multiSelection).sort((a, b) => a - b);
                            setHasVoted(true);
                            if (questionId) localStorage.setItem(`voted_${questionId}`, arr.join(","));
                            vote.mutate(arr);
                          }}
                        >
                          ✅ 送出我的 {multiSelection.size} 個選擇
                        </Button>
                      )}
                    </>
                  )}
                </div>
              )}
            </AnimatePresence>
          </div>
        </Card>
      </div>
      {questionId && <ReactionBar questionId={questionId} />}
    </div>
  );
}
