import { useEffect, useMemo, useRef, useState } from "react";
import {
  BarChart3,
  CalendarDays,
  Check,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Clipboard,
  Download,
  ExternalLink,
  Info,
  LineChart,
  ListMusic,
  ListFilter,
  LoaderCircle,
  Music2,
  Pause,
  Play,
  Plus,
  Search,
  Sparkles,
  Trash2,
  Users,
  X,
} from "lucide-react";
import archiveData from "./trl-data.json";

type Metric = "points" | "appearances";
type ViewMode = "songs" | "artists";
type BrowserMode = "rankings" | "daily";
type PreviewStatus = "idle" | "loading" | "playing" | "ready" | "paused" | "unavailable" | "error";

type PreviewResult = {
  previewUrl: string;
  trackViewUrl: string;
  artworkUrl: string | null;
  trackName: string;
  artistName: string;
  collectionName: string;
};

type PreviewLookup = {
  result: PreviewResult | null;
  status: number;
};

type AppleSearchResult = {
  artistName?: string;
  trackName?: string;
  collectionName?: string;
  previewUrl?: string;
  trackViewUrl?: string;
  artworkUrl100?: string;
};

type PreviewState = PreviewResult & {
  songId: string | null;
  status: PreviewStatus;
};

type YearRecord = {
  year: number;
  appearances: number;
  points: number | null;
  monthlyAppearances: number[];
  monthlyPoints: Array<number | null>;
  numberOnes: number;
  bestRank: number | null;
  averageRank: number | null;
  firstDate: string | null;
  lastDate: string | null;
  daily: Array<[string, number, number]>;
};

type Song = {
  id: string;
  artist: string;
  title: string;
  totalAppearances: number;
  totalPoints: number;
  pointYears: number[];
  numberOnes: number;
  bestRank: number | null;
  firstDate: string | null;
  lastDate: string | null;
  years: Record<string, YearRecord>;
};

type ArtistRow = {
  id: string;
  artist: string;
  songCount: number;
  appearances: number;
  points: number;
  numberOnes: number;
  bestRank: number | null;
  topSong: Song | null;
};

type Archive = {
  meta: {
    title: string;
    coverage: string;
    years: number[];
    pointYears: number[];
    appearanceOnlyYears: number[];
    scoring: string;
    totalAppearances: number;
    uniqueSongs: number;
    uniqueArtists: number;
    dailyRankings: number;
  };
  yearSummary: Array<{
    year: number;
    appearances: number;
    points: number | null;
    songs: number;
    artists: number;
    dailyAvailable: boolean;
    days: number;
  }>;
  songs: Song[];
  dates: Array<{
    date: string;
    year: number;
    countdownType?: string;
    entries: Array<{ rank: number; artist: string; title: string; points: number }>;
    blocks?: Array<{
      countdownType: string;
      entries: Array<{ rank: number; artist: string; title: string; points: number }>;
    }>;
  }>;
};

const DATA = archiveData as unknown as Archive;
const NUMBER = new Intl.NumberFormat("en-US");
const DATE = new Intl.DateTimeFormat("en-US", { weekday: "long", month: "long", day: "numeric", year: "numeric", timeZone: "UTC" });
const SERIES_COLORS = ["#19d7ff", "#ff2d95", "#cbff4a", "#ffb13b", "#9d7bff", "#40e6a7", "#ff6b5f", "#f4f7ff"];
const MAX_SERIES = 8;
const MONTHS = ["J", "F", "M", "A", "M", "J", "J", "A", "S", "O", "N", "D"];
const EMPTY_PREVIEW: PreviewState = {
  songId: null,
  status: "idle",
  previewUrl: "",
  trackViewUrl: "",
  artworkUrl: null,
  trackName: "",
  artistName: "",
  collectionName: "",
};

function downloadText(filename: string, content: string, type: string) {
  const link = document.createElement("a");
  link.href = URL.createObjectURL(new Blob([content], { type }));
  link.download = filename;
  link.click();
  URL.revokeObjectURL(link.href);
}

function previewJsonp(song: Song) {
  return new Promise<PreviewResult | null>((resolve) => {
    const callbackName = `totalRecapLivePreview${Date.now()}${Math.round(Math.random() * 100000)}`;
    const script = document.createElement("script");
    const callbackStore = window as unknown as Record<string, unknown>;
    const finish = (result: PreviewResult | null) => {
      window.clearTimeout(timeout);
      script.remove();
      delete callbackStore[callbackName];
      resolve(result);
    };
    const timeout = window.setTimeout(() => finish(null), 8000);
    callbackStore[callbackName] = (payload: { results?: AppleSearchResult[] }) => {
      const normalizedTitle = song.title.toLocaleLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
      const normalizedArtist = song.artist.toLocaleLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
      const matches = (payload.results || []).filter((item) => item.previewUrl && item.trackName && item.artistName);
      const match = matches.sort((left, right) => {
        const score = (item: AppleSearchResult) => {
          const title = (item.trackName || "").toLocaleLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
          const artist = (item.artistName || "").toLocaleLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
          return (title === normalizedTitle ? 4 : title.includes(normalizedTitle) || normalizedTitle.includes(title) ? 2 : 0) + (artist === normalizedArtist ? 2 : artist.includes(normalizedArtist) || normalizedArtist.includes(artist) ? 1 : 0);
        };
        return score(right) - score(left);
      })[0];
      finish(match?.previewUrl ? {
        previewUrl: match.previewUrl,
        trackViewUrl: match.trackViewUrl || "",
        artworkUrl: match.artworkUrl100?.replace("100x100bb", "200x200bb") || null,
        trackName: match.trackName || song.title,
        artistName: match.artistName || song.artist,
        collectionName: match.collectionName || "",
      } : null);
    };
    const params = new URLSearchParams({ term: `${song.artist} ${song.title}`, country: "US", media: "music", entity: "song", limit: "15", callback: callbackName });
    script.src = `https://itunes.apple.com/search?${params.toString()}`;
    script.onerror = () => finish(null);
    document.head.append(script);
  });
}

function yearsForFilter(year: number | "all") {
  return year === "all" ? DATA.meta.years : [year];
}

function songMetric(song: Song, years: number[], metric: Metric) {
  return years.reduce((total, year) => {
    const record = song.years[String(year)];
    if (!record) return total;
    return total + (metric === "points" ? record.points || 0 : record.appearances);
  }, 0);
}

function songStats(song: Song, years: number[]) {
  const records = years.map((year) => song.years[String(year)]).filter(Boolean);
  const ranks = records.map((record) => record.bestRank).filter((rank): rank is number => rank !== null);
  return {
    numberOnes: records.reduce((total, record) => total + record.numberOnes, 0),
    bestRank: ranks.length ? Math.min(...ranks) : null,
  };
}

function distinctTopSongs(songs: Song[], years: number[], metric: Metric) {
  const artists = new Set<string>();
  return [...songs]
    .sort((left, right) => songMetric(right, years, metric) - songMetric(left, years, metric))
    .filter((song) => {
      if (artists.has(song.artist)) return false;
      artists.add(song.artist);
      return true;
    })
    .slice(0, 4)
    .map((song) => song.id);
}

const DEFAULT_SONG_IDS = distinctTopSongs(DATA.songs, DATA.meta.years, "points");

function buildArtistRows(songs: Song[], years: number[], metric: Metric) {
  const grouped = new Map<string, ArtistRow>();
  songs.forEach((song) => {
    const value = grouped.get(song.artist) || {
      id: `artist-${song.artist.toLocaleLowerCase().replace(/[^a-z0-9]+/g, "-")}`,
      artist: song.artist,
      songCount: 0,
      appearances: 0,
      points: 0,
      numberOnes: 0,
      bestRank: null,
      topSong: null,
    };
    const appearances = songMetric(song, years, "appearances");
    const points = songMetric(song, years, "points");
    const stats = songStats(song, years);
    value.songCount += 1;
    value.appearances += appearances;
    value.points += points;
    value.numberOnes += stats.numberOnes;
    value.bestRank = stats.bestRank === null ? value.bestRank : value.bestRank === null ? stats.bestRank : Math.min(value.bestRank, stats.bestRank);
    if (!value.topSong || songMetric(song, years, metric) > songMetric(value.topSong, years, metric)) value.topSong = song;
    grouped.set(song.artist, value);
  });
  return [...grouped.values()].sort((left, right) => (metric === "points" ? right.points - left.points : right.appearances - left.appearances) || left.artist.localeCompare(right.artist));
}

const DEFAULT_ARTISTS = buildArtistRows(DATA.songs, DATA.meta.years, "points").slice(0, 4).map((artist) => artist.artist);

function monthlyValues(song: Song, years: number[], metric: Metric) {
  return years.flatMap((year) => {
    const record = song.years[String(year)];
    if (metric === "points" && !DATA.meta.pointYears.includes(year)) return Array(12).fill(null) as Array<number | null>;
    if (!record) return Array(12).fill(0) as number[];
    return metric === "points" ? record.monthlyPoints.map((value) => value || 0) : record.monthlyAppearances;
  });
}

function artistMonthlyValues(artist: string, years: number[], metric: Metric) {
  const artistSongs = DATA.songs.filter((song) => song.artist === artist);
  return years.flatMap((year) => Array.from({ length: 12 }, (_, month) => artistSongs.reduce((total, song) => {
    const record = song.years[String(year)];
    if (!record) return total;
    const value = metric === "points" ? record.monthlyPoints[month] : record.monthlyAppearances[month];
    return total + (value || 0);
  }, 0)));
}

function lineSegments(values: Array<number | null>, width: number, height: number, max: number) {
  const segments: string[][] = [];
  let current: string[] = [];
  values.forEach((value, index) => {
    if (value === null) {
      if (current.length) segments.push(current);
      current = [];
      return;
    }
    const x = values.length === 1 ? 0 : (index / (values.length - 1)) * width;
    const y = height - (value / max) * height;
    current.push(`${x.toFixed(2)},${y.toFixed(2)}`);
  });
  if (current.length) segments.push(current);
  return segments;
}

type ChartSeries = {
  id: string;
  label: string;
  detail: string;
  values: Array<number | null>;
};

function TimelineChart({ series, years, metric }: { series: ChartSeries[]; years: number[]; metric: Metric }) {
  const width = Math.max(920, years.length * 138);
  const height = 292;
  const maximum = Math.max(1, ...series.flatMap((item) => item.values.filter((value): value is number => value !== null)));
  const yMax = Math.max(10, Math.ceil(maximum / 10) * 10);
  const monthCount = years.length * 12;

  return (
    <div className="chart-wrap">
      <div className="chart-y-label">{metric === "points" ? "INVERSE POINTS" : "MONTHLY APPEARANCES"}</div>
      <svg className="timeline-svg" style={{ minWidth: `${width + 72}px` }} viewBox={`0 0 ${width + 72} ${height + 54}`} role="img" aria-label={`Monthly ${metric} timeline for ${series.map((item) => item.label).join(", ")}`}>
        <g transform="translate(54 14)">
          {[0, 0.25, 0.5, 0.75, 1].map((position) => {
            const y = height - position * height;
            return (
              <g key={position}>
                <line x1="0" x2={width} y1={y} y2={y} className="chart-grid" />
                <text x="-12" y={y + 4} textAnchor="end" className="axis-label">{Math.round(yMax * position)}</text>
              </g>
            );
          })}
          {years.map((year, yearIndex) => {
            const start = (yearIndex * 12 * width) / Math.max(1, monthCount - 1);
            const center = ((yearIndex * 12 + 5.5) * width) / Math.max(1, monthCount - 1);
            return (
              <g key={year}>
                {yearIndex > 0 ? <line x1={start} x2={start} y1="0" y2={height} className="year-divider" /> : null}
                <text x={center} y={height + 42} textAnchor="middle" className="year-label">{year}</text>
              </g>
            );
          })}
          {Array.from({ length: monthCount }, (_, index) => {
            const x = (index * width) / Math.max(1, monthCount - 1);
            return index % 2 === 0 ? <text key={index} x={x} y={height + 18} textAnchor="middle" className="month-label">{MONTHS[index % 12]}</text> : null;
          })}
          {series.map((item, seriesIndex) => (
            <g key={item.id}>
              {lineSegments(item.values, width, height, yMax).map((segment, index) => (
                <polyline key={index} points={segment.join(" ")} fill="none" stroke={SERIES_COLORS[seriesIndex]} strokeWidth="3" strokeLinejoin="round" strokeLinecap="round" />
              ))}
              {item.values.map((value, index) => {
                if (value === null || value === 0) return null;
                const x = (index * width) / Math.max(1, monthCount - 1);
                const y = height - (value / yMax) * height;
                const label = `${MONTHS[index % 12]} ${years[Math.floor(index / 12)]}: ${value} ${metric}`;
                return (
                  <circle key={index} cx={x} cy={y} r="3.5" fill={SERIES_COLORS[seriesIndex]} tabIndex={0}>
                    <title>{`${item.label}${item.detail ? ` — ${item.detail}` : ""}, ${label}`}</title>
                  </circle>
                );
              })}
            </g>
          ))}
        </g>
      </svg>
    </div>
  );
}

const CALENDAR_MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const CALENDAR_WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

function TimelineAddButton({ selected, disabled, label, onClick, className = "" }: { selected: boolean; disabled: boolean; label: string; onClick: () => void; className?: string }) {
  const title = selected ? "Already on the timeline" : disabled ? "Timeline is full" : label;
  return (
    <button
      type="button"
      className={`timeline-add ${selected ? "added" : ""} ${className}`.trim()}
      onClick={onClick}
      disabled={selected || disabled}
      aria-label={title}
      title={title}
    >
      {selected ? <Check size={16} /> : <Plus size={16} />}
    </button>
  );
}

function CountdownCalendar({ dates, value, onChange }: { dates: Archive["dates"]; value: string; onChange: (date: string) => void }) {
  const fallback = dates.find((item) => item.date === value) || dates.at(-1);
  const fallbackParts = (fallback?.date || "1998-01-01").split("-").map(Number);
  const [open, setOpen] = useState(false);
  const [visibleYear, setVisibleYear] = useState(fallbackParts[0]);
  const [visibleMonth, setVisibleMonth] = useState(fallbackParts[1] - 1);
  const pickerRef = useRef<HTMLDivElement>(null);
  const availableDates = useMemo(() => new Set(dates.map((item) => item.date)), [dates]);
  const availableYears = useMemo(() => [...new Set(dates.map((item) => item.year))].sort((left, right) => left - right), [dates]);
  const minimumDate = dates[0]?.date || "";
  const maximumDate = dates.at(-1)?.date || "";
  const minimumMonth = minimumDate ? Number(minimumDate.slice(0, 4)) * 12 + Number(minimumDate.slice(5, 7)) - 1 : 0;
  const maximumMonth = maximumDate ? Number(maximumDate.slice(0, 4)) * 12 + Number(maximumDate.slice(5, 7)) - 1 : 0;
  const currentMonth = visibleYear * 12 + visibleMonth;
  const firstWeekday = new Date(Date.UTC(visibleYear, visibleMonth, 1)).getUTCDay();
  const daysInMonth = new Date(Date.UTC(visibleYear, visibleMonth + 1, 0)).getUTCDate();

  useEffect(() => {
    const selected = dates.find((item) => item.date === value) || dates.at(-1);
    if (!selected) return;
    const [nextYear, nextMonth] = selected.date.split("-").map(Number);
    setVisibleYear(nextYear);
    setVisibleMonth(nextMonth - 1);
  }, [dates, value]);

  useEffect(() => {
    if (!open) return;
    const close = (event: PointerEvent) => {
      if (!pickerRef.current?.contains(event.target as Node)) setOpen(false);
    };
    const closeWithKeyboard = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    document.addEventListener("pointerdown", close);
    document.addEventListener("keydown", closeWithKeyboard);
    return () => {
      document.removeEventListener("pointerdown", close);
      document.removeEventListener("keydown", closeWithKeyboard);
    };
  }, [open]);

  function shiftMonth(amount: number) {
    const next = new Date(Date.UTC(visibleYear, visibleMonth + amount, 1));
    setVisibleYear(next.getUTCFullYear());
    setVisibleMonth(next.getUTCMonth());
  }

  return (
    <div className="calendar-picker" ref={pickerRef}>
      <span className="calendar-label">Countdown date</span>
      <button
        type="button"
        className="calendar-trigger"
        onClick={() => setOpen((current) => !current)}
        disabled={!dates.length}
        aria-haspopup="dialog"
        aria-expanded={open}
      >
        <CalendarDays size={17} />
        <span>{fallback ? DATE.format(new Date(`${fallback.date}T00:00:00Z`)) : "No dates available"}</span>
        <ChevronDown size={16} />
      </button>
      {open ? (
        <div className="countdown-calendar" role="dialog" aria-label="Choose a countdown date">
          <div className="calendar-nav">
            <button type="button" onClick={() => shiftMonth(-1)} disabled={currentMonth <= minimumMonth} aria-label="Previous month"><ChevronLeft size={18} /></button>
            <select value={visibleMonth} onChange={(event) => setVisibleMonth(Number(event.target.value))} aria-label="Month">
              {CALENDAR_MONTHS.map((month, index) => <option key={month} value={index}>{month}</option>)}
            </select>
            <select value={visibleYear} onChange={(event) => setVisibleYear(Number(event.target.value))} aria-label="Year">
              {availableYears.map((calendarYear) => <option key={calendarYear} value={calendarYear}>{calendarYear}</option>)}
            </select>
            <button type="button" onClick={() => shiftMonth(1)} disabled={currentMonth >= maximumMonth} aria-label="Next month"><ChevronRight size={18} /></button>
          </div>
          <div className="calendar-weekdays" aria-hidden="true">
            {CALENDAR_WEEKDAYS.map((day) => <span key={day}>{day}</span>)}
          </div>
          <div className="calendar-grid">
            {Array.from({ length: 42 }, (_, index) => {
              const day = index - firstWeekday + 1;
              if (day < 1 || day > daysInMonth) return <span key={index} />;
              const isoDate = `${visibleYear}-${String(visibleMonth + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
              const available = availableDates.has(isoDate);
              const selected = isoDate === value;
              return (
                <button
                  type="button"
                  key={isoDate}
                  className={selected ? "selected" : ""}
                  disabled={!available}
                  onClick={() => { onChange(isoDate); setOpen(false); }}
                  aria-label={available ? DATE.format(new Date(`${isoDate}T00:00:00Z`)) : undefined}
                  aria-pressed={selected}
                >
                  {day}
                </button>
              );
            })}
          </div>
          <p>Highlighted dates have a stored countdown.</p>
        </div>
      ) : null}
    </div>
  );
}

export default function Home() {
  const [year, setYear] = useState<number | "all">("all");
  const [metric, setMetric] = useState<Metric>("points");
  const [viewMode, setViewMode] = useState<ViewMode>("songs");
  const [timelineMode, setTimelineMode] = useState<ViewMode>("songs");
  const [query, setQuery] = useState("");
  const [selectedSongIds, setSelectedSongIds] = useState<string[]>(DEFAULT_SONG_IDS);
  const [selectedArtists, setSelectedArtists] = useState<string[]>(DEFAULT_ARTISTS);
  const [chartQuery, setChartQuery] = useState("");
  const [chartSearchOpen, setChartSearchOpen] = useState(false);
  const [activeSongId, setActiveSongId] = useState(DEFAULT_SONG_IDS[0]);
  const [searchOpen, setSearchOpen] = useState(false);
  const [browserMode, setBrowserMode] = useState<BrowserMode>("rankings");
  const [page, setPage] = useState(0);
  const [selectedDate, setSelectedDate] = useState(DATA.dates.at(-1)?.date || "");
  const [playlistSongIds, setPlaylistSongIds] = useState<string[]>([]);
  const [playlistOpen, setPlaylistOpen] = useState(false);
  const [playlistReady, setPlaylistReady] = useState(false);
  const [playlistNotice, setPlaylistNotice] = useState("");
  const [preview, setPreview] = useState<PreviewState>(EMPTY_PREVIEW);
  const searchRef = useRef<HTMLInputElement>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const previewRequestRef = useRef(0);
  const previewCacheRef = useRef(new Map<string, Promise<PreviewLookup>>());
  const selectedYears = yearsForFilter(year);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      try {
        const saved = JSON.parse(localStorage.getItem("total-recap-live-playlist") || "[]") as string[];
        setPlaylistSongIds(saved.filter((id) => DATA.songs.some((song) => song.id === id)));
      } catch {
        setPlaylistSongIds([]);
      }
      setPlaylistReady(true);
    }, 0);
    return () => window.clearTimeout(timer);
  }, []);

  useEffect(() => {
    if (playlistReady) localStorage.setItem("total-recap-live-playlist", JSON.stringify(playlistSongIds));
  }, [playlistReady, playlistSongIds]);

  const matchingSongs = useMemo(() => {
    const normalized = query.trim().toLocaleLowerCase();
    return DATA.songs.filter((song) => {
      const inYear = selectedYears.some((item) => song.years[String(item)]);
      const matches = !normalized || `${song.title} ${song.artist}`.toLocaleLowerCase().includes(normalized);
      return inYear && matches;
    });
  }, [query, selectedYears]);

  const songRows = useMemo(() => {
    return [...matchingSongs]
      .sort((left, right) => songMetric(right, selectedYears, metric) - songMetric(left, selectedYears, metric) || right.totalAppearances - left.totalAppearances);
  }, [matchingSongs, selectedYears, metric]);

  const artistRows = useMemo(() => {
    return buildArtistRows(matchingSongs, selectedYears, metric);
  }, [matchingSongs, selectedYears, metric]);

  const allArtistRows = useMemo(() => buildArtistRows(DATA.songs.filter((song) => selectedYears.some((item) => song.years[String(item)])), selectedYears, metric), [selectedYears, metric]);
  const selectedSongs = selectedSongIds.map((id) => DATA.songs.find((song) => song.id === id)).filter((song): song is Song => Boolean(song));
  const timelineSeries = timelineMode === "songs"
    ? selectedSongs.map((song) => ({ id: song.id, label: song.title, detail: song.artist, values: monthlyValues(song, selectedYears, metric) }))
    : selectedArtists.map((artist) => ({ id: `artist-${artist}`, label: artist, detail: "Artist total", values: artistMonthlyValues(artist, selectedYears, metric) }));
  const activeSeriesCount = timelineMode === "songs" ? selectedSongs.length : selectedArtists.length;
  const normalizedChartQuery = chartQuery.trim().toLocaleLowerCase();
  const chartSongCandidates = DATA.songs
    .filter((song) => selectedYears.some((item) => song.years[String(item)]))
    .filter((song) => !selectedSongIds.includes(song.id))
    .filter((song) => !normalizedChartQuery || `${song.title} ${song.artist}`.toLocaleLowerCase().includes(normalizedChartQuery))
    .sort((left, right) => songMetric(right, selectedYears, metric) - songMetric(left, selectedYears, metric))
    .slice(0, 8);
  const chartArtistCandidates = allArtistRows
    .filter((artist) => !selectedArtists.includes(artist.artist))
    .filter((artist) => !normalizedChartQuery || artist.artist.toLocaleLowerCase().includes(normalizedChartQuery))
    .slice(0, 8);
  const topSong = songRows[0] || DATA.songs[0];
  const activeSong = DATA.songs.find((song) => song.id === activeSongId) || selectedSongs[0] || topSong;
  const searchSongs = DATA.songs
    .filter((song) => query.trim() && `${song.title} ${song.artist}`.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase()))
    .sort((left, right) => right.totalAppearances - left.totalAppearances)
    .slice(0, 7);
  const searchArtists = [...new Set(searchSongs.map((song) => song.artist))].slice(0, 4);
  const dailyDates = DATA.dates.filter((item) => year === "all" || item.year === year);
  const dateRecord = dailyDates.find((item) => item.date === selectedDate);
  const dateBlocks = dateRecord
    ? dateRecord.blocks?.length
      ? dateRecord.blocks
      : [{ countdownType: dateRecord.countdownType || "Countdown", entries: dateRecord.entries }]
    : [];
  const dateEntryCount = dateBlocks.reduce((total, block) => total + block.entries.length, 0);
  const dateIndex = dateRecord ? dailyDates.findIndex((item) => item.date === dateRecord.date) : -1;
  const resultCount = viewMode === "songs" ? songRows.length : artistRows.length;
  const pageCount = Math.max(1, Math.ceil(resultCount / 20));
  const safePage = Math.min(page, pageCount - 1);
  const pageStart = safePage * 20;
  const playlistSongs = playlistSongIds.map((id) => DATA.songs.find((song) => song.id === id)).filter((song): song is Song => Boolean(song));
  const activeSongInPlaylist = playlistSongIds.includes(activeSong.id);
  const activeSongInTimeline = selectedSongIds.includes(activeSong.id);

  useEffect(() => {
    const filteredDates = DATA.dates.filter((item) => year === "all" || item.year === year);
    setSelectedDate((current) => filteredDates.some((item) => item.date === current) ? current : filteredDates.at(-1)?.date || "");
  }, [year]);

  function fetchPreview(song: Song) {
    const cached = previewCacheRef.current.get(song.id);
    if (cached) return cached;
    const request = previewJsonp(song).then((result) => ({ result, status: result ? 200 : 404 }));
    previewCacheRef.current.set(song.id, request);
    return request;
  }

  async function playPreview(song: Song) {
    const requestId = ++previewRequestRef.current;
    audioRef.current?.pause();
    setPreview({ ...EMPTY_PREVIEW, songId: song.id, status: "loading" });
    const lookup = await fetchPreview(song);
    if (requestId !== previewRequestRef.current) return;
    const result = lookup.result;
    if (!result?.previewUrl) {
      setPreview({ ...EMPTY_PREVIEW, songId: song.id, status: lookup.status === 404 ? "unavailable" : "error" });
      return;
    }
    const audio = audioRef.current || new Audio();
    audioRef.current = audio;
    audio.src = result.previewUrl;
    audio.onplay = () => setPreview((current) => current.songId === song.id ? { ...current, status: "playing" } : current);
    audio.onpause = () => setPreview((current) => current.songId === song.id && !audio.ended ? { ...current, status: "paused" } : current);
    audio.onended = () => setPreview((current) => current.songId === song.id ? { ...current, status: "ready" } : current);
    audio.onerror = () => setPreview((current) => current.songId === song.id ? { ...current, status: "error" } : current);
    setPreview({ ...result, songId: song.id, status: "ready" });
    try {
      await audio.play();
      if (requestId === previewRequestRef.current) setPreview({ ...result, songId: song.id, status: "playing" });
    } catch {
      if (requestId === previewRequestRef.current) setPreview({ ...result, songId: song.id, status: "ready" });
    }
  }

  function selectSong(song: Song) {
    setActiveSongId(song.id);
    setSearchOpen(false);
    if (preview.songId !== song.id) void playPreview(song);
  }

  async function toggleSongPreview(song: Song) {
    setActiveSongId(song.id);
    const audio = audioRef.current;
    if (preview.songId === song.id && preview.status === "loading") return;
    if (preview.songId !== song.id || !preview.previewUrl || !audio) {
      await playPreview(song);
      return;
    }
    if (!audio.paused && !audio.ended) {
      audio.pause();
      return;
    }
    if (audio.ended) audio.currentTime = 0;
    try {
      await audio.play();
      setPreview((current) => ({ ...current, status: "playing" }));
    } catch {
      setPreview((current) => ({ ...current, status: "ready" }));
    }
  }

  function togglePlaylist(song: Song) {
    setPlaylistSongIds((current) => {
      if (current.includes(song.id)) return current.filter((id) => id !== song.id);
      setPlaylistOpen(true);
      return [...current, song.id];
    });
  }

  function exportPlaylist() {
    const rows = [["Position", "Artist", "Song"], ...playlistSongs.map((song, index) => [index + 1, song.artist, song.title])];
    const csv = rows.map((row) => row.map((value) => `"${String(value).replaceAll('"', '""')}"`).join(",")).join("\n");
    downloadText("total-recap-live-playlist.csv", csv, "text/csv;charset=utf-8");
  }

  async function copyPlaylist() {
    const text = playlistSongs.map((song, index) => `${index + 1}. ${song.artist} — ${song.title}`).join("\n");
    try {
      await navigator.clipboard.writeText(text);
      setPlaylistNotice("Playlist copied");
      window.setTimeout(() => setPlaylistNotice(""), 1800);
    } catch {
      downloadText("total-recap-live-playlist.txt", text, "text/plain;charset=utf-8");
    }
  }

  function addSong(song: Song) {
    setTimelineMode("songs");
    setSelectedSongIds((current) => current.includes(song.id) || current.length >= MAX_SERIES ? current : [...current, song.id]);
    setSearchOpen(false);
    setChartSearchOpen(false);
    setChartQuery("");
  }

  function removeSong(id: string) {
    setSelectedSongIds((current) => current.filter((item) => item !== id));
  }

  function addArtist(artist: string) {
    setTimelineMode("artists");
    setSelectedArtists((current) => current.includes(artist) || current.length >= MAX_SERIES ? current : [...current, artist]);
    setSearchOpen(false);
    setChartSearchOpen(false);
    setChartQuery("");
  }

  function removeArtist(artist: string) {
    setSelectedArtists((current) => current.filter((item) => item !== artist));
  }

  function pickArtist(artist: string) {
    setViewMode("artists");
    setQuery(artist);
    setPage(0);
    setSearchOpen(false);
  }

  function findEntrySong(artist: string, title: string) {
    const normalized = `${artist}\u241f${title}`.toLocaleLowerCase();
    return DATA.songs.find((song) => `${song.artist}\u241f${song.title}`.toLocaleLowerCase() === normalized);
  }

  function downloadCsv() {
    const header = viewMode === "songs"
      ? ["Rank", "Artist", "Song", "Appearances", "Points", "Years", "Number Ones", "Best Rank"]
      : ["Rank", "Artist", "Songs", "Appearances", "Points", "Number Ones", "Best Rank"];
    const rows = viewMode === "songs"
      ? songRows.map((song, index) => {
          const stats = songStats(song, selectedYears);
          return [index + 1, song.artist, song.title, songMetric(song, selectedYears, "appearances"), songMetric(song, selectedYears, "points"), song.pointYears.join("; "), stats.numberOnes, stats.bestRank || ""];
        })
      : artistRows.map((artist, index) => [index + 1, artist.artist, artist.songCount, artist.appearances, artist.points, artist.numberOnes, artist.bestRank || ""]);
    const csv = [header, ...rows].map((row) => row.map((value) => `"${String(value).replaceAll('"', '""')}"`).join(",")).join("\n");
    downloadText(`total-recap-live-${viewMode}-${year === "all" ? "1998-2008" : year}-${metric}.csv`, csv, "text/csv;charset=utf-8");
  }

  return (
    <>
    <main className="app-shell">
      <div className="top-ticker" aria-live="polite">
        <div className="ticker-primary">
          <strong>{preview.status === "playing" ? "NOW PLAYING:" : "SPOTLIGHT:"}</strong>
          <span>{activeSong.artist} — {activeSong.title}</span>
          <i />
          <span>{metric === "points" ? "POINTS" : "APPEARANCES"}: {NUMBER.format(songMetric(activeSong, selectedYears, metric))}</span>
          <i />
          <span>{year === "all" ? "ALL YEARS" : year}</span>
        </div>
        <div className="ticker-secondary">
          <strong>DATA:</strong>
          <span>{DATA.meta.coverage}</span>
        </div>
      </div>

      <header className="site-header">
        <div className="masthead-wrap">
          <div className="masthead-copy">
            <h1>Total Recap Live</h1>
            <p>Explore more than a decade of MTV countdown history</p>
          </div>
          <span>1998—2008</span>
        </div>
        <div className="search-shell">
          <Search size={22} aria-hidden="true" />
          <input
            ref={searchRef}
            value={query}
            onChange={(event) => {
              setQuery(event.target.value);
              setPage(0);
              setSearchOpen(Boolean(event.target.value));
            }}
            onFocus={() => setSearchOpen(Boolean(query))}
            onKeyDown={(event) => {
              if (event.key === "Escape") setSearchOpen(false);
              if (event.key === "Enter" && searchSongs[0]) selectSong(searchSongs[0]);
            }}
            placeholder="Search songs or artists"
            aria-label="Search songs or artists"
            role="combobox"
            aria-autocomplete="list"
            aria-controls="archive-search-results"
            aria-expanded={searchOpen}
          />
          {query ? <button className="clear-search" onClick={() => { setQuery(""); setPage(0); setSearchOpen(false); searchRef.current?.focus(); }} aria-label="Clear search"><X size={18} /></button> : null}
          {searchOpen ? (
            <div className="search-results" id="archive-search-results">
              {searchSongs.length ? (
                <>
                  <span className="result-label">SONGS</span>
                  {searchSongs.map((song) => (
                    <div className="search-result-row" key={song.id} onMouseDown={(event) => event.preventDefault()}>
                      <button className="search-result-main" onClick={() => selectSong(song)}>
                        <Music2 size={16} />
                        <span><strong>{song.title}</strong><small>{song.artist}</small></span>
                        <em>{song.totalAppearances} apps</em>
                      </button>
                      <TimelineAddButton
                        selected={selectedSongIds.includes(song.id)}
                        disabled={selectedSongIds.length >= MAX_SERIES}
                        label={`Add ${song.title} to the song timeline`}
                        onClick={() => addSong(song)}
                        className="search-add"
                      />
                    </div>
                  ))}
                  {searchArtists.length ? <span className="result-label">ARTISTS</span> : null}
                  {searchArtists.map((artist) => (
                    <div className="search-result-row" key={artist} onMouseDown={(event) => event.preventDefault()}>
                      <button className="search-result-main" onClick={() => pickArtist(artist)}>
                        <Users size={16} />
                        <span><strong>{artist}</strong><small>View artist totals</small></span>
                      </button>
                      <TimelineAddButton
                        selected={selectedArtists.includes(artist)}
                        disabled={selectedArtists.length >= MAX_SERIES}
                        label={`Add ${artist} to the artist timeline`}
                        onClick={() => addArtist(artist)}
                        className="search-add"
                      />
                    </div>
                  ))}
                </>
              ) : <p className="no-results">No matching songs or artists.</p>}
            </div>
          ) : null}
        </div>
      </header>

      <section className="control-bar" aria-label="Archive filters">
        <div className="scope-control">
          <CalendarDays size={18} />
          <span>{year === "all" ? "ALL YEARS" : year}</span>
          <ChevronDown size={16} />
        </div>
        <div className="year-tabs" role="group" aria-label="Filter by year">
          <button className={year === "all" ? "active" : ""} onClick={() => { setYear("all"); setPage(0); }}>ALL</button>
          {DATA.meta.years.map((item) => <button key={item} className={year === item ? "active" : ""} onClick={() => { setYear(item); setPage(0); }}>{item}</button>)}
        </div>
        <div className="view-tabs" role="group" aria-label="Browse songs or artists">
          <button className={viewMode === "songs" ? "active" : ""} onClick={() => { setViewMode("songs"); setPage(0); }}><Music2 size={17} /> Songs</button>
          <button className={viewMode === "artists" ? "active" : ""} onClick={() => { setViewMode("artists"); setPage(0); }}><Users size={17} /> Artists</button>
        </div>
        <div className="metric-tabs" role="group" aria-label="Choose ranking metric">
          <button className={metric === "points" ? "active" : ""} onClick={() => { setMetric("points"); setPage(0); }}><LineChart size={17} /> Points</button>
          <button className={metric === "appearances" ? "active" : ""} onClick={() => { setMetric("appearances"); setPage(0); }}><BarChart3 size={17} /> Apps</button>
        </div>
        <button className="playlist-button" onClick={() => setPlaylistOpen(true)}><ListMusic size={17} /> Playlist <b>{playlistSongs.length}</b></button>
        <button className="download-button" onClick={downloadCsv}><Download size={17} /> CSV</button>
      </section>

      <section className="stat-strip" aria-label="Archive totals">
        <div><strong>{NUMBER.format(DATA.meta.totalAppearances)}</strong><span>Chart appearances</span></div>
        <div><strong>{NUMBER.format(DATA.meta.uniqueSongs)}</strong><span>Normalized songs</span></div>
        <div><strong>{NUMBER.format(DATA.meta.uniqueArtists)}</strong><span>Artist credits</span></div>
        <div><strong>{NUMBER.format(DATA.meta.dailyRankings)}</strong><span>Daily countdowns</span></div>
      </section>

      <section className="primary-grid">
        <article className="panel timeline-panel">
          <div className="panel-header timeline-header">
            <div><span className="eyebrow">MONTH BY MONTH</span><h2>Timeline</h2></div>
            <div className="timeline-controls">
              <div className="timeline-mode-tabs" role="group" aria-label="Chart songs or artists">
                <button className={timelineMode === "songs" ? "active" : ""} onClick={() => setTimelineMode("songs")}><Music2 size={16} /> Songs</button>
                <button className={timelineMode === "artists" ? "active" : ""} onClick={() => setTimelineMode("artists")}><Users size={16} /> Artists</button>
              </div>
              <span className="series-count">{activeSeriesCount} / {MAX_SERIES} selected</span>
            </div>
          </div>
          <div className="series-toolbar">
            <div className="legend" aria-label={`Selected timeline ${timelineMode}`}>
              {timelineSeries.map((item, index) => (
                <button key={item.id} onClick={() => timelineMode === "songs" ? removeSong(item.id) : removeArtist(item.label)} title="Remove from timeline">
                  <i style={{ background: SERIES_COLORS[index] }} />
                  <span>{item.label}{item.detail && timelineMode === "songs" ? ` — ${item.detail}` : ""}</span>
                  <X size={14} />
                </button>
              ))}
            </div>
            <div className="plot-picker">
              <Search size={16} aria-hidden="true" />
              <input
                value={chartQuery}
                onChange={(event) => { setChartQuery(event.target.value); setChartSearchOpen(true); }}
                onFocus={() => setChartSearchOpen(true)}
                onKeyDown={(event) => { if (event.key === "Escape") setChartSearchOpen(false); }}
                placeholder={`Add ${timelineMode === "songs" ? "a song" : "an artist"}`}
                aria-label={`Add ${timelineMode === "songs" ? "a song" : "an artist"} to the timeline`}
                disabled={activeSeriesCount >= MAX_SERIES}
              />
              <Plus size={17} aria-hidden="true" />
              {chartSearchOpen && activeSeriesCount < MAX_SERIES ? (
                <div className="plot-results">
                  {timelineMode === "songs" ? chartSongCandidates.map((song) => (
                    <button key={song.id} onMouseDown={(event) => event.preventDefault()} onClick={() => addSong(song)}>
                      <Plus size={15} />
                      <span><strong>{song.title}</strong><small>{song.artist}</small></span>
                      <em>{NUMBER.format(songMetric(song, selectedYears, metric))}</em>
                    </button>
                  )) : chartArtistCandidates.map((artist) => (
                    <button key={artist.id} onMouseDown={(event) => event.preventDefault()} onClick={() => addArtist(artist.artist)}>
                      <Plus size={15} />
                      <span><strong>{artist.artist}</strong><small>{artist.songCount} charting {artist.songCount === 1 ? "song" : "songs"}</small></span>
                      <em>{NUMBER.format(metric === "points" ? artist.points : artist.appearances)}</em>
                    </button>
                  ))}
                  {(timelineMode === "songs" ? chartSongCandidates.length : chartArtistCandidates.length) === 0 ? <p>No more matches for this filter.</p> : null}
                </div>
              ) : null}
            </div>
          </div>
          {timelineSeries.length ? <TimelineChart series={timelineSeries} years={selectedYears} metric={metric} /> : <div className="empty-chart"><Sparkles size={26} /><p>Add up to eight {timelineMode} to build a comparison.</p></div>}
          <div className="chart-caption">
            <span>{metric === "points" ? "Monthly inverse-point totals" : "Monthly Top 10 appearances"} for {timelineMode}</span>
            <span className="coverage-note">All eleven years include daily rank data</span>
          </div>
        </article>

        <article className="panel leaderboard-panel">
          <div className="panel-header">
            <div><span className="eyebrow">FILTERED RANKING</span><h2>Top {viewMode === "songs" ? "Songs" : "Artists"}</h2></div>
            <span className="row-count">{viewMode === "songs" ? matchingSongs.length : artistRows.length} results</span>
          </div>
          <div className="leader-head">
            <span>Rank</span><span>{viewMode === "songs" ? "Song / artist" : "Artist / top song"}</span><span>{metric === "points" ? "Points" : "Apps"}</span><span>{viewMode === "songs" ? "Peak" : "Songs"}</span><span aria-label="Add to timeline" />
          </div>
          <div className="leader-list">
            {viewMode === "songs" ? songRows.slice(0, 10).map((song, index) => {
              const value = songMetric(song, selectedYears, metric);
              const stats = songStats(song, selectedYears);
              const maximum = Math.max(1, songMetric(songRows[0], selectedYears, metric));
              const isSelected = selectedSongIds.includes(song.id);
              return (
                <div key={song.id} className={`leader-row ${isSelected ? "selected" : ""}`}>
                  <button className="leader-select" onClick={() => selectSong(song)}>
                    <strong className="rank-cell">{String(index + 1).padStart(2, "0")}</strong>
                    <span className="song-cell"><b>{song.title}</b><small>{song.artist}</small></span>
                    <span className="value-cell"><b>{NUMBER.format(value)}</b><i><em style={{ width: `${(value / maximum) * 100}%` }} /></i></span>
                    <span className="peak-cell">{stats.bestRank ? `#${stats.bestRank}` : "—"}</span>
                  </button>
                  <TimelineAddButton selected={isSelected} disabled={selectedSongIds.length >= MAX_SERIES} label={`Add ${song.title} to the song timeline`} onClick={() => addSong(song)} className="leader-add" />
                </div>
              );
            }) : artistRows.slice(0, 10).map((artist, index) => {
              const value = metric === "points" ? artist.points : artist.appearances;
              const maximum = Math.max(1, metric === "points" ? artistRows[0]?.points || 1 : artistRows[0]?.appearances || 1);
              const isSelected = selectedArtists.includes(artist.artist);
              return (
                <div key={artist.id} className={`leader-row ${isSelected ? "selected" : ""}`}>
                  <button className="leader-select" onClick={() => pickArtist(artist.artist)}>
                    <strong className="rank-cell">{String(index + 1).padStart(2, "0")}</strong>
                    <span className="song-cell"><b>{artist.artist}</b><small>{artist.topSong ? `Top song: ${artist.topSong.title}` : ""}</small></span>
                    <span className="value-cell"><b>{NUMBER.format(value)}</b><i><em style={{ width: `${(value / maximum) * 100}%` }} /></i></span>
                    <span className="peak-cell">{artist.songCount}</span>
                  </button>
                  <TimelineAddButton selected={isSelected} disabled={selectedArtists.length >= MAX_SERIES} label={`Add ${artist.artist} to the artist timeline`} onClick={() => addArtist(artist.artist)} className="leader-add" />
                </div>
              );
            })}
          </div>
        </article>
      </section>

      <section className="explorer-section">
        <div className="explorer-head">
          <div>
            <span className="eyebrow">GO DEEPER</span>
            <h2>Archive Browser</h2>
          </div>
          <div className="explorer-tabs" role="group" aria-label="Archive browser mode">
            <button className={browserMode === "rankings" ? "active" : ""} onClick={() => setBrowserMode("rankings")}><ListFilter size={17} /> Full rankings</button>
            <button className={browserMode === "daily" ? "active" : ""} onClick={() => setBrowserMode("daily")}><CalendarDays size={17} /> Daily countdowns</button>
          </div>
        </div>

        <div className="explorer-grid">
          <article className="panel browser-panel">
            {browserMode === "rankings" ? (
              <>
                <div className="browser-toolbar">
                  <div><strong>{NUMBER.format(resultCount)}</strong><span>{viewMode} in the current filter</span></div>
                  <span>Rows {resultCount ? pageStart + 1 : 0}–{Math.min(pageStart + 20, resultCount)}</span>
                </div>
                <div className="table-scroll">
                  <table className="archive-table">
                    <thead>
                      <tr><th>#</th><th>{viewMode === "songs" ? "Song / Artist" : "Artist / Top Song"}</th><th>Apps</th><th>Points</th><th>#1s</th><th>{viewMode === "songs" ? "Peak" : "Songs"}</th><th aria-label="Add to timeline" /></tr>
                    </thead>
                    <tbody>
                      {viewMode === "songs" ? songRows.slice(pageStart, pageStart + 20).map((song, index) => {
                        const stats = songStats(song, selectedYears);
                        return (
                          <tr key={song.id} className={activeSong.id === song.id ? "active" : ""}>
                            <td>{pageStart + index + 1}</td>
                            <td><button className="archive-select" onClick={() => selectSong(song)}><strong>{song.title}</strong><span>{song.artist}</span></button></td>
                            <td>{NUMBER.format(songMetric(song, selectedYears, "appearances"))}</td>
                            <td>{NUMBER.format(songMetric(song, selectedYears, "points"))}</td>
                            <td>{stats.numberOnes || "—"}</td>
                            <td>{stats.bestRank ? `#${stats.bestRank}` : "—"}</td>
                            <td className="table-add-cell"><TimelineAddButton selected={selectedSongIds.includes(song.id)} disabled={selectedSongIds.length >= MAX_SERIES} label={`Add ${song.title} to the song timeline`} onClick={() => addSong(song)} className="table-add" /></td>
                          </tr>
                        );
                      }) : artistRows.slice(pageStart, pageStart + 20).map((artist, index) => (
                        <tr key={artist.id}>
                          <td>{pageStart + index + 1}</td>
                          <td><button className="archive-select" onClick={() => pickArtist(artist.artist)}><strong>{artist.artist}</strong><span>{artist.topSong?.title || ""}</span></button></td>
                          <td>{NUMBER.format(artist.appearances)}</td>
                          <td>{NUMBER.format(artist.points)}</td>
                          <td>{artist.numberOnes || "—"}</td>
                          <td>{artist.songCount}</td>
                          <td className="table-add-cell"><TimelineAddButton selected={selectedArtists.includes(artist.artist)} disabled={selectedArtists.length >= MAX_SERIES} label={`Add ${artist.artist} to the artist timeline`} onClick={() => addArtist(artist.artist)} className="table-add" /></td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <div className="pagination">
                  <button disabled={safePage === 0} onClick={() => setPage((current) => Math.max(0, current - 1))}><ChevronLeft size={17} /> Previous</button>
                  <span>Page {safePage + 1} of {pageCount}</span>
                  <button disabled={safePage >= pageCount - 1} onClick={() => setPage((current) => Math.min(pageCount - 1, current + 1))}>Next <ChevronRight size={17} /></button>
                </div>
              </>
            ) : (
              <>
                <div className="daily-toolbar">
                  <button aria-label="Previous countdown" disabled={dateIndex <= 0} onClick={() => dateIndex > 0 && setSelectedDate(dailyDates[dateIndex - 1].date)}><ChevronLeft size={19} /></button>
                  <CountdownCalendar dates={dailyDates} value={selectedDate} onChange={setSelectedDate} />
                  <button aria-label="Next countdown" disabled={dateIndex < 0 || dateIndex >= dailyDates.length - 1} onClick={() => dateIndex >= 0 && dateIndex < dailyDates.length - 1 && setSelectedDate(dailyDates[dateIndex + 1].date)}><ChevronRight size={19} /></button>
                </div>
                {dateRecord ? (
                  <div className="daily-chart-list">
                    <div className="daily-date"><span>{DATE.format(new Date(`${dateRecord.date}T00:00:00Z`))}</span><em>{dateBlocks.length > 1 ? `${dateBlocks.length} countdowns · ` : ""}{dateEntryCount} ranked songs</em></div>
                    {dateBlocks.map((block, blockIndex) => (
                      <div className="daily-countdown-block" key={`${block.countdownType}-${blockIndex}`}>
                        {dateBlocks.length > 1 || block.countdownType.toLocaleLowerCase() !== "regular top 10" && block.countdownType.toLocaleLowerCase() !== "regular top ten" ? <div className="daily-countdown-type"><span>{block.countdownType}</span><em>{block.entries.length} entries</em></div> : null}
                        {block.entries.map((entry) => {
                          const song = findEntrySong(entry.artist, entry.title);
                          return (
                            <div className="daily-chart-row" key={`${blockIndex}-${entry.rank}-${entry.artist}-${entry.title}`}>
                              <button className="daily-song-select" onClick={() => song && selectSong(song)} disabled={!song}>
                                <strong>{entry.rank}</strong>
                                <span><b>{entry.title}</b><small>{entry.artist}</small></span>
                                <em>{entry.points} {entry.points === 1 ? "pt" : "pts"}</em>
                              </button>
                              {song ? <TimelineAddButton selected={selectedSongIds.includes(song.id)} disabled={selectedSongIds.length >= MAX_SERIES} label={`Add ${song.title} to the song timeline`} onClick={() => addSong(song)} className="daily-add" /> : null}
                            </div>
                          );
                        })}
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="daily-empty">
                    <CalendarDays size={34} />
                    <h3>No daily rankings stored for {year === "all" ? "this filter" : year}</h3>
                    <p>No countdown is available for this filter.</p>
                    <div>{DATA.meta.pointYears.map((item) => <button key={item} onClick={() => setYear(item)}>{item}</button>)}</div>
                  </div>
                )}
              </>
            )}
          </article>

          <aside className="panel spotlight-panel">
            <div className="spotlight-kicker"><span>SONG SPOTLIGHT</span><i>{activeSong.pointYears.length > 1 ? `${activeSong.pointYears[0]}–${activeSong.pointYears.at(-1)}` : activeSong.pointYears[0]}</i></div>
            <h3>{activeSong.title}</h3>
            <p>{activeSong.artist}</p>
            <div className={`preview-card ${preview.songId === activeSong.id ? preview.status : "idle"}`}>
              {preview.songId === activeSong.id && preview.artworkUrl ? <div className="preview-image" style={{ backgroundImage: `url("${preview.artworkUrl}")` }} aria-hidden="true" /> : <div className="preview-art"><Music2 size={22} /></div>}
              <button className="preview-toggle" onClick={() => void toggleSongPreview(activeSong)} disabled={preview.songId === activeSong.id && preview.status === "loading"} aria-label={preview.songId === activeSong.id && preview.status === "playing" ? "Pause preview" : "Play Apple Music preview"}>
                {preview.songId === activeSong.id && preview.status === "loading" ? <LoaderCircle className="spin" size={20} /> : preview.songId === activeSong.id && preview.status === "playing" ? <Pause size={20} /> : <Play size={20} />}
              </button>
              <div className="preview-copy">
                <strong>APPLE MUSIC PREVIEW</strong>
                <span>{preview.songId !== activeSong.id || preview.status === "idle" ? "Select play to hear a preview" : preview.status === "loading" ? "Finding the closest catalog match…" : preview.status === "playing" ? "Playing preview" : preview.status === "paused" ? "Preview paused" : preview.status === "unavailable" ? "No preview found for this song" : preview.status === "error" ? "Preview could not be played" : "Preview ready"}</span>
              </div>
              {preview.songId === activeSong.id && preview.trackViewUrl ? <a href={preview.trackViewUrl} target="_blank" rel="noreferrer" aria-label="Open this song in Apple Music"><ExternalLink size={17} /></a> : null}
            </div>
            <div className="spotlight-stats">
              <div><strong>{NUMBER.format(songMetric(activeSong, selectedYears, "appearances"))}</strong><span>Appearances</span></div>
              <div><strong>{NUMBER.format(songMetric(activeSong, selectedYears, "points"))}</strong><span>Points</span></div>
              <div><strong>{songStats(activeSong, selectedYears).numberOnes || "—"}</strong><span>#1 days</span></div>
              <div><strong>{songStats(activeSong, selectedYears).bestRank ? `#${songStats(activeSong, selectedYears).bestRank}` : "—"}</strong><span>Best rank</span></div>
            </div>
            <div className="year-breakdown">
              <span className="breakdown-title">YEAR-BY-YEAR</span>
              {DATA.meta.years.map((item) => {
                const record = activeSong.years[String(item)];
                if (!record) return null;
                const maxApps = Math.max(...Object.values(activeSong.years).map((value) => value.appearances), 1);
                return (
                  <div className="year-row" key={item}>
                    <strong>{item}</strong>
                    <span><i style={{ width: `${(record.appearances / maxApps) * 100}%` }} /></span>
                    <em>{record.appearances} {record.appearances === 1 ? "app" : "apps"}</em>
                    <b>{record.points === null ? "points n/a" : `${record.points} pts`}</b>
                  </div>
                );
              })}
            </div>
            <div className="spotlight-actions">
              <button className={`spotlight-action ${activeSongInTimeline ? "active" : ""}`} onClick={() => addSong(activeSong)} disabled={activeSongInTimeline || selectedSongIds.length >= MAX_SERIES}>{activeSongInTimeline ? <Check size={17} /> : <Plus size={17} />} {activeSongInTimeline ? "Added to timeline" : "Add to timeline"}</button>
              <button className={`spotlight-action playlist-action ${activeSongInPlaylist ? "active" : ""}`} onClick={() => togglePlaylist(activeSong)}>{activeSongInPlaylist ? <Check size={17} /> : <ListMusic size={17} />} {activeSongInPlaylist ? "Remove from playlist" : "Add to playlist"}</button>
            </div>
          </aside>
        </div>
      </section>

      <section className="method-strip">
        <Info size={22} />
        <div><strong>METHODOLOGY</strong><span>#1 = 10 points · #2 = 9 · … · #10 = 1</span></div>
        <p>Every recoverable countdown with 10 or fewer ranked entries is included, including specials, retrospectives, Top 5s, and partial countdowns.</p>
        <p><b>Coverage:</b> Daily rankings, appearances, and inverse points from September 1998 through October 2008.</p>
        <Check size={20} />
      </section>
    </main>
    {playlistOpen ? <button className="playlist-backdrop" onClick={() => setPlaylistOpen(false)} aria-label="Close playlist" /> : null}
    <aside className={`playlist-drawer ${playlistOpen ? "open" : ""}`} role="dialog" aria-modal={playlistOpen} aria-label="My playlist" aria-hidden={!playlistOpen}>
      <div className="playlist-head">
        <div><span className="eyebrow">YOUR COUNTDOWN</span><h2>My Playlist</h2></div>
        <button onClick={() => setPlaylistOpen(false)} aria-label="Close playlist"><X size={22} /></button>
      </div>
      <div className="playlist-summary">
        <strong>{playlistSongs.length}</strong>
        <span>{playlistSongs.length === 1 ? "song" : "songs"} saved in this browser</span>
        {playlistNotice ? <em>{playlistNotice}</em> : null}
      </div>
      <div className="playlist-list">
        {playlistSongs.length ? playlistSongs.map((song, index) => (
          <div className={`playlist-row ${activeSong.id === song.id ? "active" : ""}`} key={song.id}>
            <button className="playlist-track" onClick={() => void toggleSongPreview(song)} disabled={preview.songId === song.id && preview.status === "loading"} aria-label={preview.songId === song.id && preview.status === "playing" ? `Pause ${song.title}` : `Play ${song.title}`}>
              <strong>{String(index + 1).padStart(2, "0")}</strong>
              <span><b>{song.title}</b><small>{song.artist}</small></span>
              {preview.songId === song.id && preview.status === "loading" ? <LoaderCircle className="spin" size={16} /> : preview.songId === song.id && preview.status === "playing" ? <Pause size={16} /> : <Play size={16} />}
            </button>
            <button className="playlist-remove" onClick={() => togglePlaylist(song)} aria-label={`Remove ${song.title} from playlist`}><X size={17} /></button>
          </div>
        )) : (
          <div className="playlist-empty"><ListMusic size={34} /><h3>Build your own TRL</h3><p>Select a song, then choose “Add to playlist.” Your picks will stay here when you return.</p></div>
        )}
      </div>
      <div className="playlist-footer">
        <button onClick={exportPlaylist} disabled={!playlistSongs.length}><Download size={17} /> Export CSV</button>
        <button onClick={() => void copyPlaylist()} disabled={!playlistSongs.length}><Clipboard size={17} /> Copy list</button>
        <button className="clear-playlist" onClick={() => setPlaylistSongIds([])} disabled={!playlistSongs.length}><Trash2 size={17} /> Clear</button>
      </div>
    </aside>
    </>
  );
}
