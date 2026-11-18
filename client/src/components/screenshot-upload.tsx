import { useState, useEffect } from "react";
import { useMutation } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { useToast } from "@/hooks/use-toast";
import * as firestore from "@/lib/firestore-voting";
import { auth } from "@/lib/firebase";
import { onAuthStateChanged } from "firebase/auth";
import { useParams } from "wouter";
import { motion, AnimatePresence } from "framer-motion";
import { CheckCircle2, ChevronLeft, ChevronRight, X, ZoomIn } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { ReactionBar } from "@/components/reaction-bar";
import { useConfetti } from "@/hooks/use-confetti";
import { useVotingSound } from "@/hooks/use-voting-sounds";
import { errorDetails, reportServiceEvent } from "@/lib/telemetry";

export default function Student() {
  const { toast } = useToast();
  const params = useParams<{ id: string }>();
  const questionId = params.id;
  const [question, setQuestion] = useState<any | null>(null);
  const [notFound, setNotFound] = useState(false);
  const [hasVoted, setHasVoted] = useState(false);
  const [showSuccessOverlay, setShowSuccessOverlay] = useState(false);
  const [currentSlide, setCurrentSlide] = useState(0);
  const [isZoomed, setIsZoomed] = useState(false);
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

  const imagesList = Array.isArray(question?.imageUrl) ? question.imageUrl : question?.imageUrl ? [question.imageUrl] : [];

  const nextSlide = () => setCurrentSlide(prev => (prev + 1) % imagesList.length);
  const prevSlide = () => setCurrentSlide(prev => (prev - 1 + imagesList.length) % imagesList.length);

  const isExpired = firestore.isQuestionExpired(question);
  const requireIdentity: boolean = !!question?.requireIdentity;

  const [committedName] = useState<string>(() => localStorage.getItem("voter_name") || "");
  const isMultiple = question?.questionType === "multiple";
  const [multiSelection, setMultiSelection] = useState<Set<number>>(new Set());

  const vote = useMutation({
    mutationFn: async (selection: firestore.VoteSelection) => {
      if (!question) return;
      if (isExpired) throw new Error("此題投票已結束");
      await firestore.addVote(question.id, selection, requireIdentity ? { name: committedName } : undefined);
    },
    onSuccess: (_, selection) => {
      triggerConfetti();
      try { playVoteSubmitted(); } catch {}
      setShowSuccessOverlay(true);
      window.setTimeout(() => setShowSuccessOverlay(false), 1800);
      setHasVoted(true);
      setSelectedOption(typeof selection === "number" ? selection : null);
      if (question?.id) {
        localStorage.setItem(`voted_${question.id}`, String(selection));
      }
    },
    onError: (error: any) => {
      toast({ title: "投票失敗", description: error.message, variant: "destructive" });
    },
  });

  if (!question) {
    return (
      <div className="page-container text-center">
        <h1 className="text-2xl font-bold gradient-text">目前沒有活動的問題</h1>
      </div>
    );
  }

  return (
    <div className="playful-shell min-h-screen p-2 sm:p-4">
      {/* 全螢幕左右滑動照片檢視器 */}
      <AnimatePresence>
        {isZoomed && imagesList.length > 0 && (
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="fixed inset-0 z-[9999] bg-black/95 flex flex-col items-center justify-center p-2">
            <button onClick={() => setIsZoomed(false)} className="absolute top-4 right-4 bg-white/20 text-white p-3 rounded-full">
              <X className="w-6 h-6" />
            </button>
            <div className="text-white text-base mb-2 font-bold">
              歌手照片 {currentSlide + 1} / {imagesList.length}
            </div>
            <div className="relative w-full max-w-2xl h-[75vh] flex items-center justify-center">
              {imagesList.length > 1 && (
                <>
                  <button onClick={prevSlide} className="absolute left-2 z-10 bg-white/30 text-white p-3 rounded-full hover:bg-white/50">
                    <ChevronLeft className="w-8 h-8" />
                  </button>
                  <button onClick={nextSlide} className="absolute right-2 z-10 bg-white/30 text-white p-3 rounded-full hover:bg-white/50">
                    <ChevronRight className="w-8 h-8" />
                  </button>
                </>
              )}
              <motion.img key={currentSlide} src={imagesList[currentSlide]} initial={{ opacity: 0, x: 50 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -50 }} className="max-h-full max-w-full object-contain rounded-xl" />
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      <div className="max-w-2xl mx-auto relative z-10">
        <Card className="overflow-hidden shadow-xl border-0 bg-white/95 backdrop-blur-sm rounded-3xl">
          {imagesList.length > 0 && (
            <div className="relative group bg-slate-900 cursor-pointer" onClick={() => setIsZoomed(true)}>
              <div className="relative h-[320px] sm:h-[400px] flex items-center justify-center">
                {imagesList.length > 1 && (
                  <>
                    <button onClick={(e) => { e.stopPropagation(); prevSlide(); }} className="absolute left-2 z-10 bg-black/50 text-white p-2 rounded-full">
                      <ChevronLeft className="w-6 h-6" />
                    </button>
                    <button onClick={(e) => { e.stopPropagation(); nextSlide(); }} className="absolute right-2 z-10 bg-black/50 text-white p-2 rounded-full">
                      <ChevronRight className="w-6 h-6" />
                    </button>
                  </>
                )}
                <img src={imagesList[currentSlide]} alt="歌手照片" className="max-h-full max-w-full object-contain" />
              </div>
              <div className="absolute bottom-3 right-3 bg-black/70 text-white text-xs px-3 py-1 rounded-full flex items-center gap-1">
                <ZoomIn className="w-4 h-4" /> 點擊左右滑動 / 放大 ({currentSlide + 1}/{imagesList.length})
              </div>
            </div>
          )}

          <div className="p-4 sm:p-6 space-y-4">
            <h2 className="text-lg font-extrabold text-slate-900">請選擇你最喜歡的歌手</h2>
            <div className="flex flex-col gap-2.5">
              {question.options.map((option: string, index: number) => (
                <button
                  key={index}
                  type="button"
                  disabled={hasVoted || vote.isPending}
                  onClick={() => {
                    setHasVoted(true);
                    vote.mutate(index);
                  }}
                  className="w-full flex items-center gap-3 p-4 rounded-2xl border-2 bg-white hover:bg-slate-50 transition-all text-left"
                >
                  <span className="w-10 h-10 rounded-xl bg-blue-500 text-white font-bold flex items-center justify-center">
                    {String.fromCharCode(65 + index)}
                  </span>
                  <span className="flex-1 text-lg font-bold text-slate-900">{option}</span>
                </button>
              ))}
            </div>
          </div>
        </Card>
      </div>
    </div>
  );
}
