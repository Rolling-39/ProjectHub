// ─────────────────────────────────────────────────────────────
// ProjectHub / shared/icons.js —— lucide 单色图标封装
// ─────────────────────────────────────────────────────────────
// lucide 的 SVG 是 stroke: currentColor，颜色完全由所在元素的 color
// 继承 → 主题色一换，导航/按钮/卡片图标全部联动。禁止用 Emoji。
//
// ── 为什么不用 lucide 的 icons 对象做动态查找 ──
// 1) 那个对象的键是 **PascalCase**（本版本 1743 个键：FolderGit2 / Cpu /
//    FileText…），而条目 icon 字段里存的是 kebab-case（folder-git-2）。
//    写成 icons['folder-git-2'] 永远得到 undefined，图标功能静默失效。
// 2) import { icons } 是一个含全部图标的大对象，打包器无法摇树 ——
//    实测它会让完整图标集（约 332 KB，占全部 JS 的 61%）进包。
// 所以这里改为白名单 + 静态 import：可用名字显式列在 ICONS 里，
// 名字与节点一一对应，编译期就能发现写错的名字。
//
// 加/删图标：改本文件的 NAMES 来源（ICONS 映射）并跑一次 npm run build，
// 确认产物里不再出现 icons-*.js 这类整包 chunk。
import {
    createElement,
    Folder, FolderOpen, FolderPlus, FolderSearch, FolderTree, FolderGit2,
    FolderCode, File, FileText, FileCode, FileJson, FileSpreadsheet,
    FileImage, FileAudio, FileVideo, FileArchive, FileTerminal, FileSearch,
    Code, Terminal, Braces, Binary, Regex, Bug,
    GitBranch, GitFork, Github, Package, Box, Boxes,
    Container, Server, Database, HardDrive, Cloud, Cpu,
    MemoryStick, CircuitBoard, Cog, Wrench, Layers, Blocks,
    Network, Plug, Zap, Cable, Book, BookOpen,
    Notebook, NotebookPen, Library, GraduationCap, Lightbulb, FlaskConical,
    Atom, Pencil, PenTool, Brush, Palette, Highlighter,
    StickyNote, ClipboardList, Ruler, Microscope, Brain, ScrollText,
    Link, Link2, Globe, ExternalLink, Rss, Mail,
    MessageSquare, Video, Music, Headphones, Radio, Camera,
    Image, Film, Mic, Speaker, Tv, Monitor,
    Smartphone, Star, Heart, Bookmark, Tag, Tags,
    Flag, Pin, Home, Building2, Store, ShoppingCart,
    Wallet, CreditCard, Calendar, Clock, AlarmClock, Timer,
    Bell, Search, Filter, List, ListChecks, Grid3x3,
    LayoutDashboard, Table, Kanban, ChartPie, Activity, Target,
    Award, Trophy, Rocket, Flame, Sprout, Sun,
    Moon, Gamepad2, Puzzle, Gift, Coffee, Plane,
    Car, Map, MapPin, Compass, Mountain, Waves,
    Check, CheckCheck, X, TriangleAlert, CircleAlert, Info,
    CircleHelp, Circle, CircleDot, Ban, Shield, ShieldCheck,
    Lock, Unlock, Key, Fingerprint, Eye, EyeOff,
    User, Users, UserCog, Bot, Sparkles, Wand2,
} from 'lucide';

/** kebab-case 名字 → lucide 图标节点。不在此表内的名字一律不可用。 */
const ICONS = {
    'folder': Folder,
    'folder-open': FolderOpen,
    'folder-plus': FolderPlus,
    'folder-search': FolderSearch,
    'folder-tree': FolderTree,
    'folder-git-2': FolderGit2,
    'folder-code': FolderCode,
    'file': File,
    'file-text': FileText,
    'file-code': FileCode,
    'file-json': FileJson,
    'file-spreadsheet': FileSpreadsheet,
    'file-image': FileImage,
    'file-audio': FileAudio,
    'file-video': FileVideo,
    'file-archive': FileArchive,
    'file-terminal': FileTerminal,
    'file-search': FileSearch,
    'code': Code,
    'terminal': Terminal,
    'braces': Braces,
    'binary': Binary,
    'regex': Regex,
    'bug': Bug,
    'git-branch': GitBranch,
    'git-fork': GitFork,
    'github': Github,
    'package': Package,
    'box': Box,
    'boxes': Boxes,
    'container': Container,
    'server': Server,
    'database': Database,
    'hard-drive': HardDrive,
    'cloud': Cloud,
    'cpu': Cpu,
    'memory-stick': MemoryStick,
    'circuit-board': CircuitBoard,
    'cog': Cog,
    'wrench': Wrench,
    'layers': Layers,
    'blocks': Blocks,
    'network': Network,
    'plug': Plug,
    'zap': Zap,
    'cable': Cable,
    'book': Book,
    'book-open': BookOpen,
    'notebook': Notebook,
    'notebook-pen': NotebookPen,
    'library': Library,
    'graduation-cap': GraduationCap,
    'lightbulb': Lightbulb,
    'flask-conical': FlaskConical,
    'atom': Atom,
    'pencil': Pencil,
    'pen-tool': PenTool,
    'brush': Brush,
    'palette': Palette,
    'highlighter': Highlighter,
    'sticky-note': StickyNote,
    'clipboard-list': ClipboardList,
    'ruler': Ruler,
    'microscope': Microscope,
    'brain': Brain,
    'scroll-text': ScrollText,
    'link': Link,
    'link-2': Link2,
    'globe': Globe,
    'external-link': ExternalLink,
    'rss': Rss,
    'mail': Mail,
    'message-square': MessageSquare,
    'video': Video,
    'music': Music,
    'headphones': Headphones,
    'radio': Radio,
    'camera': Camera,
    'image': Image,
    'film': Film,
    'mic': Mic,
    'speaker': Speaker,
    'tv': Tv,
    'monitor': Monitor,
    'smartphone': Smartphone,
    'star': Star,
    'heart': Heart,
    'bookmark': Bookmark,
    'tag': Tag,
    'tags': Tags,
    'flag': Flag,
    'pin': Pin,
    'home': Home,
    'building-2': Building2,
    'store': Store,
    'shopping-cart': ShoppingCart,
    'wallet': Wallet,
    'credit-card': CreditCard,
    'calendar': Calendar,
    'clock': Clock,
    'alarm-clock': AlarmClock,
    'timer': Timer,
    'bell': Bell,
    'search': Search,
    'filter': Filter,
    'list': List,
    'list-checks': ListChecks,
    'grid-3x3': Grid3x3,
    'layout-dashboard': LayoutDashboard,
    'table': Table,
    'kanban': Kanban,
    'chart-pie': ChartPie,
    'activity': Activity,
    'target': Target,
    'award': Award,
    'trophy': Trophy,
    'rocket': Rocket,
    'flame': Flame,
    'sprout': Sprout,
    'sun': Sun,
    'moon': Moon,
    'gamepad-2': Gamepad2,
    'puzzle': Puzzle,
    'gift': Gift,
    'coffee': Coffee,
    'plane': Plane,
    'car': Car,
    'map': Map,
    'map-pin': MapPin,
    'compass': Compass,
    'mountain': Mountain,
    'waves': Waves,
    'check': Check,
    'check-check': CheckCheck,
    'x': X,
    'triangle-alert': TriangleAlert,
    'circle-alert': CircleAlert,
    'info': Info,
    'circle-help': CircleHelp,
    'circle': Circle,
    'circle-dot': CircleDot,
    'ban': Ban,
    'shield': Shield,
    'shield-check': ShieldCheck,
    'lock': Lock,
    'unlock': Unlock,
    'key': Key,
    'fingerprint': Fingerprint,
    'eye': Eye,
    'eye-off': EyeOff,
    'user': User,
    'users': Users,
    'user-cog': UserCog,
    'bot': Bot,
    'sparkles': Sparkles,
    'wand-2': Wand2,
};

/** 可用图标名（字典序）。选择器与 AI 提示词都从这里取，保证与实际实现一致。 */
export const ICON_NAMES = Object.keys(ICONS).sort();

function sized(svg, size) {
    svg.setAttribute('width', String(size));
    svg.setAttribute('height', String(size));
    svg.setAttribute('aria-hidden', 'true');
    return svg;
}

/** 把 lucide 图标节点（import { Folder } from 'lucide'）转成 SVG 元素 */
export function navIcon(node, size = 16) {
    return sized(createElement(node), size);
}

export const inlineIcon = navIcon;

/**
 * 按名字渲染图标（条目自定义 icon 字段用，kebab-case，如 'folder-git-2'）。
 * 名字不认识时返回 null，调用方应回落到首字母色块。
 */
export function icon(name, size = 16) {
    const node = ICONS[String(name ?? '').trim().toLowerCase()];
    if (!node) return null;
    return sized(createElement(node), size);
}

/** 名字是否可用（表单校验用，避免存进库里一个渲染不出来的名字） */
export function hasIcon(name) {
    return !!ICONS[String(name ?? '').trim().toLowerCase()];
}
