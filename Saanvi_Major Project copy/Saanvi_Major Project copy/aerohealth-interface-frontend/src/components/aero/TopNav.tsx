import { motion } from "motion/react";
import { Command, MapPin, Moon, Search, Sun, UserRound, MessageSquare, FileText, BookOpen } from "lucide-react";
import { useEffect, useState } from "react";
import { Link, useLocation } from "@tanstack/react-router";

import {
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import { EASE } from "@/lib/aero/ui";
import type { LatLon } from "@/lib/aero/types";
import { searchWorldwide } from "@/lib/aero/api";

export const PLACES: { name: string; region: string; loc: LatLon }[] = [
  { name: "Mangaluru", region: "IN · Karnataka coast", loc: { lat: 12.841690, lon: 74.922980 } },
  { name: "Delhi", region: "IN · Indo-Gangetic plain", loc: { lat: 28.6139, lon: 77.209 } },
  { name: "London", region: "UK · Thames basin", loc: { lat: 51.5072, lon: -0.1276 } },
  { name: "San Francisco", region: "US · Bay Area", loc: { lat: 37.7749, lon: -122.4194 } },
  { name: "Tokyo", region: "JP · Kantō", loc: { lat: 35.6762, lon: 139.6503 } },
  { name: "Jakarta", region: "ID · Java", loc: { lat: -6.2088, lon: 106.8456 } },
  { name: "Copenhagen", region: "DK · Zealand", loc: { lat: 55.6761, lon: 12.5683 } },
];

export function TopNav({
  place,
  onPlace,
  dark,
  onTheme,
  onOpenChange,
}: {
  place: string;
  onPlace: (name: string, loc: LatLon) => void;
  dark: boolean;
  onTheme: (dark: boolean) => void;
  onOpenChange: (open: boolean) => void;
}) {
  const [open, setOpen] = useState(false);
  const [searching, setSearching] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [locationResults, setLocationResults] = useState<Array<{ location: LatLon; displayName: string }>>([]);
  const location = useLocation();

  function buildGeocodeCandidates(query: string) {
    const trimmed = query.trim();
    const lowered = trimmed.toLowerCase();
    const candidates = [trimmed];

    const aliasMap: Record<string, string> = {
      Adyar: "Adyar, Mangaluru taluk, Dakshina Kannada, Karnataka, India",
      Kapu: "Kapu, Kapu taluku, Udupi, Karnataka, India",
      Vittla: "Vitla",
      Kulsheker: "Kulshekar",
      Kulshekeri: "Kulshekar",
    };

    for (const [from, to] of Object.entries(aliasMap)) {
      if (new RegExp(`\\b${from}\\b`, "i").test(trimmed)) {
        candidates.push(trimmed.replace(new RegExp(`\\b${from}\\b`, "ig"), to));
      }
    }

    const isLocalQuery = /adyar|bejai|kapu|udupi|vitla|vittla|kulshekar|kulsheker|mangaluru|mangalore|surathkal|panambur|moodbidri|moodabidri/i.test(trimmed);
    if (isLocalQuery && !/india|karnataka|udupi|dakshina|mangaluru|mangalore/i.test(trimmed)) {
      candidates.push(`${trimmed}, Karnataka, India`);
    }

    if (lowered.includes("adyar")) {
      candidates.push("Adyar, Mangaluru taluk, Dakshina Kannada, Karnataka, India");
    }

    if (lowered.includes("kapu")) {
      candidates.push("Kapu, Kapu taluku, Udupi, Karnataka, India");
    }

    return candidates;
  }

  const navItems = [
    { path: "/", label: "Dashboard", icon: null },
    { path: "/assistant", label: "AI Assistant", icon: <MessageSquare size={14} /> },
    { path: "/reports", label: "Reports", icon: <FileText size={14} /> },
    { path: "/learn", label: "Learn", icon: <BookOpen size={14} /> },
  ];

  useEffect(() => onOpenChange(open), [open, onOpenChange]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "k" && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        setOpen((o) => !o);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  function selectLocation(result: { location: LatLon; displayName: string }) {
      onPlace(result.displayName, result.location);
      setOpen(false);
      setSearchQuery("");
  }

  useEffect(() => {
    const query = searchQuery.trim();
    if (query.length < 2 || !open) {
      setLocationResults([]);
      setSearching(false);
      return;
    }
    const controller = new AbortController();
    const timer = setTimeout(() => {
      setSearching(true);
      searchWorldwide(query, controller.signal)
        .then((results) => setLocationResults(results))
        .catch((error: unknown) => {
          if (!(error instanceof DOMException && error.name === "AbortError")) setLocationResults([]);
        })
        .finally(() => setSearching(false));
    }, 250);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [open, searchQuery]);

  return (
    <motion.header
      initial={{ opacity: 0, y: -10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.6, ease: EASE }}
      className="sticky top-0 z-30 border-b border-hairline bg-background/60 backdrop-blur-xl"
    >
      <div className="mx-auto flex h-16 w-full max-w-[1500px] items-center gap-4 px-5">
        <div className="flex items-center gap-2.5">
          <span className="relative flex size-2.5 items-center justify-center">
            <span className="absolute size-2.5 animate-radar rounded-full bg-primary" />
            <span className="size-1.5 rounded-full bg-primary" />
          </span>
          <span className="num text-[13px] tracking-[0.34em] uppercase">aerohealth</span>
        </div>

        {/* Navigation Links */}
        <div className="flex items-center gap-1 ml-4">
          {navItems.map((item) => (
            <Link
              key={item.path}
              to={item.path}
              className={`press flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs transition-colors ${
                location.pathname === item.path
                  ? 'bg-primary/15 text-primary border border-primary/30'
                  : 'text-muted-foreground hover:text-foreground hover:bg-surface-2'
              }`}
            >
              {item.icon}
              <span>{item.label}</span>
            </Link>
          ))}
        </div>

        <button
          onClick={() => setOpen(true)}
          className="press group ml-2 flex h-9 flex-1 max-w-md items-center gap-2.5 rounded-xl border border-hairline bg-surface-2 px-3 text-left transition-colors hover:border-primary/35"
        >
          <Search size={14} strokeWidth={1.5} className="text-muted-foreground" />
          <span className="num truncate text-[11px] text-muted-foreground">{place}</span>
          <span className="num ml-auto flex items-center gap-1 rounded-md border border-hairline px-1.5 py-0.5 text-[9px] text-muted-foreground">
            <Command size={9} strokeWidth={1.5} />K
          </span>
        </button>

        <div className="ml-auto flex items-center gap-3">
          <button
            aria-label="Toggle theme"
            onClick={() => onTheme(!dark)}
            className="relative h-7 w-12 rounded-full border border-hairline bg-surface-2 transition-colors hover:border-primary/35"
          >
            <motion.span
              layout
              transition={{ type: "spring", stiffness: 520, damping: 34 }}
              className="absolute top-[3px] flex size-5 items-center justify-center rounded-full bg-surface-3 text-foreground shadow-[0_0_12px_-2px_var(--primary)]"
              style={{ left: dark ? 3 : 25 }}
            >
              {dark ? (
                <Moon size={11} strokeWidth={1.6} />
              ) : (
                <Sun size={11} strokeWidth={1.6} />
              )}
            </motion.span>
          </button>
          <span className="flex size-8 items-center justify-center rounded-full border border-hairline bg-surface-2">
            <UserRound size={14} strokeWidth={1.4} className="text-muted-foreground" />
          </span>
        </div>
      </div>

      <CommandDialog open={open} onOpenChange={setOpen}>
        <CommandInput 
          placeholder="Search any location worldwide..." 
          value={searchQuery}
          onValueChange={setSearchQuery}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && locationResults[0] && !searching) {
              selectLocation(locationResults[0]);
            }
          }}
        />
        <CommandList>
          {searching ? <div className="py-6 text-center text-sm text-muted-foreground">Searching worldwide...</div> : null}
          {!searching && searchQuery.trim() && !locationResults.length ? <CommandEmpty>No mapped locations found. Add a country or region to narrow the search.</CommandEmpty> : null}
          {!searching && locationResults.length ? <CommandGroup heading="Choose a mapped location">{locationResults.map((result) => <CommandItem key={`${result.location.lat}-${result.location.lon}`} value={result.displayName} onSelect={() => selectLocation(result)}><MapPin size={13} strokeWidth={1.5} /><span className="truncate">{result.displayName}</span></CommandItem>)}</CommandGroup> : null}
          <CommandGroup heading="Popular monitoring stations">
            {PLACES.map((p) => (
              <CommandItem
                key={p.name}
                value={`${p.name} ${p.region}`}
                onSelect={() => {
                  onPlace(p.name, p.loc);
                  setOpen(false);
                }}
              >
                <MapPin size={13} strokeWidth={1.5} />
                <span>{p.name}</span>
                <span className="num ml-auto text-[10px] text-muted-foreground">
                  {p.loc.lat.toFixed(2)}, {p.loc.lon.toFixed(2)}
                </span>
              </CommandItem>
            ))}
          </CommandGroup>
          
        </CommandList>
      </CommandDialog>
    </motion.header>
  );
}