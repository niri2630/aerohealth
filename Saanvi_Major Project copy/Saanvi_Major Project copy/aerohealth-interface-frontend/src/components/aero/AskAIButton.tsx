import { useNavigate } from "@tanstack/react-router";
import { Sparkles } from "lucide-react";
import { motion } from "motion/react";

interface AskAIButtonProps {
  prompt: string;
  context?: any;
  variant?: "default" | "subtle" | "floating";
  label?: string;
}

/**
 * Ask AI button that navigates to assistant with pre-filled prompt and context
 */
export function AskAIButton({ 
  prompt, 
  context, 
  variant = "default",
  label = "Ask AI"
}: AskAIButtonProps) {
  const navigate = useNavigate();

  function compactContext(value: any) {
    if (!value?.safe_route || !value?.direct_route) return value;
    return {
      ...value,
      safe_route: { ...value.safe_route, geojson: undefined },
      direct_route: { ...value.direct_route, geojson: undefined },
    };
  }

  function handleClick() {
    // Navigate to assistant with context in URL params
    navigate({
      to: "/assistant",
      search: {
        prompt,
        context: context ? JSON.stringify(compactContext(context)) : undefined
      }
    });
  }

  if (variant === "floating") {
    return (
      <motion.button
        whileHover={{ scale: 1.05 }}
        whileTap={{ scale: 0.95 }}
        onClick={handleClick}
        className="absolute top-3 right-3 z-10 press flex items-center gap-1.5 rounded-full border border-primary/30 bg-primary/10 backdrop-blur-sm px-3 py-1.5 text-xs font-medium text-primary shadow-lg hover:bg-primary/20 transition-all"
        title={prompt}
      >
        <Sparkles size={12} />
        <span>{label}</span>
      </motion.button>
    );
  }

  if (variant === "subtle") {
    return (
      <button
        onClick={handleClick}
        className="press inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-primary transition-colors"
        title={prompt}
      >
        <Sparkles size={12} />
        <span>{label}</span>
      </button>
    );
  }

  return (
    <button
      onClick={handleClick}
      className="press flex items-center gap-1.5 rounded-lg border border-primary/30 bg-primary/10 px-3 py-1.5 text-xs font-medium text-primary hover:bg-primary/20 transition-colors"
      title={prompt}
    >
      <Sparkles size={12} />
      <span>{label}</span>
    </button>
  );
}
