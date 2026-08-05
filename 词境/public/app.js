"use strict";

const FSRS6 = [0.212, 1.2931, 2.3065, 8.2956, 6.4133, 0.8334, 3.0194, 0.001, 1.8722, 0.1666, 0.796, 1.4835, 0.0614, 0.2629, 1.6483, 0.6014, 1.8729, 0.5425, 0.0912, 0.0658, 0.1542];
const DEFAULT_SETTINGS = { targetRetention: 0.92, reviewGate: 100, wordRate: 0.76, sentenceRate: 0.9, voiceURI: "", reducedMotion: false, darkMode: false, dailyNewTarget: 10, dailyReviewTarget: 30 };
const APP = document.querySelector("#app");
const TOAST = document.querySelector("#toast");
const SPEAKER_TEMPLATE = document.querySelector("#speaker-template");
const SPEAKER_ICON = SPEAKER_TEMPLATE.content.firstElementChild.innerHTML;
const CONTENT_LIBRARY = window.WORD_CONTENT_LIBRARY || {};
const IMPORTED_WORD_DETAILS = {
  unit: { zh: "单位；单元；部件；组；单位的", partOfSpeech: "n. / adj.", currentSense: "单位；单元" },
  speech: { zh: "演讲；言语", partOfSpeech: "n.", currentSense: "演讲；言语" }, tile: { zh: "瓷砖；瓦片", partOfSpeech: "n.", currentSense: "瓷砖；瓦片" },
  dorm: { zh: "宿舍", partOfSpeech: "n.", currentSense: "宿舍" }, dictionary: { zh: "词典；字典", partOfSpeech: "n.", currentSense: "词典；字典" },
  screen: { zh: "屏幕；屏风；筛选", partOfSpeech: "n. / v.", currentSense: "屏幕" }, lover: { zh: "恋人；爱好者", partOfSpeech: "n.", currentSense: "恋人；爱好者" },
  shirt: { zh: "衬衫", partOfSpeech: "n.", currentSense: "衬衫" }, emphasize: { zh: "强调；着重", partOfSpeech: "v.", currentSense: "强调；着重" },
  pollution: { zh: "污染", partOfSpeech: "n.", currentSense: "污染" }, shepherd: { zh: "牧羊人；引导", partOfSpeech: "n. / v.", currentSense: "牧羊人" },
  foster: { zh: "培养；促进；寄养的", partOfSpeech: "v. / adj.", currentSense: "培养；促进" }, favorite: { zh: "最喜欢的；特别喜爱的人（或物）", partOfSpeech: "adj. / n.", currentSense: "最喜欢的" },
  technology: { zh: "技术；科技", partOfSpeech: "n.", currentSense: "技术；科技" }, wipe: { zh: "擦拭；清除", partOfSpeech: "v.", currentSense: "擦拭；清除" },
  scold: { zh: "责骂；训斥", partOfSpeech: "v.", currentSense: "责骂；训斥" }, dessert: { zh: "甜点；餐后甜食", partOfSpeech: "n.", currentSense: "甜点；餐后甜食" },
  outlet: { zh: "出口；插座；商店（销售点）", partOfSpeech: "n.", currentSense: "出口；插座；商店（销售点）" }, list: { zh: "清单；列出", partOfSpeech: "n. / v.", currentSense: "清单" },
  important: { zh: "重要的", partOfSpeech: "adj.", currentSense: "重要的" }, fatigue: { zh: "疲劳；使疲劳", partOfSpeech: "n. / v.", currentSense: "疲劳" },
  insure: { zh: "投保；确保", partOfSpeech: "v.", currentSense: "投保；确保" }, vicious: { zh: "凶恶的；恶性的", partOfSpeech: "adj.", currentSense: "凶恶的；恶性的" },
  tame: { zh: "驯服的；驯服", partOfSpeech: "adj. / v.", currentSense: "驯服的" }, vapour: { zh: "蒸气", partOfSpeech: "n.", currentSense: "蒸气" },
  fold: { zh: "折叠；褶痕", partOfSpeech: "v. / n.", currentSense: "折叠" }, rain: { zh: "雨；下雨", partOfSpeech: "n. / v.", currentSense: "雨" },
  monster: { zh: "怪物；巨兽", partOfSpeech: "n.", currentSense: "怪物；巨兽" }, injure: { zh: "使受伤；损害", partOfSpeech: "v.", currentSense: "使受伤；损害" },
  pass: { zh: "通过；经过；及格；通行证", partOfSpeech: "v. / n.", currentSense: "通过；经过" }, astonish: { zh: "使惊讶；使吃惊", partOfSpeech: "v.", currentSense: "使惊讶；使吃惊" },
  component: { zh: "组成部分；部件", partOfSpeech: "n.", currentSense: "组成部分；部件" }, tea: { zh: "茶", partOfSpeech: "n.", currentSense: "茶" },
  mountain: { zh: "山；山脉", partOfSpeech: "n.", currentSense: "山；山脉" }, small: { zh: "小的；少的", partOfSpeech: "adj.", currentSense: "小的" },
  isolate: { zh: "隔离；使孤立", partOfSpeech: "v.", currentSense: "隔离；使孤立" }, administer: { zh: "管理；施用", partOfSpeech: "v.", currentSense: "管理；施用" },
  trail: { zh: "小径；踪迹；拖着走", partOfSpeech: "n. / v.", currentSense: "小径；踪迹" }, hospital: { zh: "医院", partOfSpeech: "n.", currentSense: "医院" },
  elegant: { zh: "优雅的；精美的", partOfSpeech: "adj.", currentSense: "优雅的；精美的" }, conversation: { zh: "谈话；会话", partOfSpeech: "n.", currentSense: "谈话；会话" },
  interest: { zh: "兴趣；利息；使感兴趣", partOfSpeech: "n. / v.", currentSense: "兴趣" }, naughty: { zh: "淘气的；顽皮的", partOfSpeech: "adj.", currentSense: "淘气的；顽皮的" },
  trolley: { zh: "手推车；电车", partOfSpeech: "n.", currentSense: "手推车；电车" }, fork: { zh: "叉子；岔路；分叉", partOfSpeech: "n. / v.", currentSense: "叉子；岔路" },
  awake: { zh: "醒着的；醒来", partOfSpeech: "adj. / v.", currentSense: "醒着的" }, away: { zh: "离开；远离", partOfSpeech: "adv.", currentSense: "离开；远离" },
  banana: { zh: "香蕉", partOfSpeech: "n.", currentSense: "香蕉" }, unlikely: { zh: "不太可能的", partOfSpeech: "adj.", currentSense: "不太可能的" },
  temporary: { zh: "暂时的；临时的", partOfSpeech: "adj.", currentSense: "暂时的；临时的" }, advance: { zh: "前进；推进；进步；预付款", partOfSpeech: "v. / n.", currentSense: "前进；推进" },
  locality: { zh: "地区；地点", partOfSpeech: "n.", currentSense: "地区；地点" }
};

const LEXICON = {
  bank: { zh: "银行；银行服务", phonetic: "/bæŋk/", kind: "place", sentence: "Grandfather paid his utility bill with a bank app.", review: [["爷爷在手机银行缴纳水电费。", "Grandfather paid his utility bill with a ____ app."], ["艾拉去银行开了一个新账户。", "Ella opened a new account at the ____. "]] },
  bridge: { zh: "桥", phonetic: "/brɪdʒ/", kind: "place", sentence: "A small bridge carries us across the river.", review: [["孩子们走过河上的木桥。", "The children walked over the wooden ____."], ["雾里能看见一座连接两岸的桥。", "In the mist, a ____ joined the two sides of the river."]] },
  ticket: { zh: "票；车票", phonetic: "/ˈtɪkɪt/", kind: "object", sentence: "Mina kept her train ticket in a blue pocket.", review: [["出发前，他把车票放进了口袋。", "Before leaving, he put his ____ in his pocket."], ["检票员请每位乘客出示车票。", "The inspector asked every passenger to show a ____. "]] },
  book: { zh: "书", phonetic: "/bʊk/", kind: "object", sentence: "At night, Leo read a book by the window.", review: [["睡前，安打开了一本故事书。", "Before bed, Ann opened a story ____."], ["图书馆员把书放回书架。", "The librarian returned the ____ to its shelf."]] },
  market: { zh: "市场；集市", phonetic: "/ˈmɑːrkɪt/", kind: "place", sentence: "The market smelled of fruit and warm bread.", review: [["周六早晨，人们在市场挑选新鲜水果。", "On Saturday morning, people chose fresh fruit at the ____."], ["她从市场带回一束小花。", "She brought home a small bunch of flowers from the ____. "]] },
  station: { zh: "车站", phonetic: "/ˈsteɪʃn/", kind: "place", sentence: "We waited at the quiet station for the last train.", review: [["火车站的时钟刚好指向八点。", "The clock at the ____ showed exactly eight."], ["他们在车站门口互相道别。", "They said goodbye at the entrance to the ____. "]] },
  garden: { zh: "花园", phonetic: "/ˈɡɑːrdn/", kind: "place", sentence: "In the garden, rain rested on every leaf.", review: [["奶奶在花园里给玫瑰浇水。", "Grandma watered the roses in the ____."], ["午后的猫躺在花园的石头上。", "The afternoon cat lay on a stone in the ____. "]] },
  river: { zh: "河；河流", phonetic: "/ˈrɪvər/", kind: "place", sentence: "The river moved slowly under the evening sky.", review: [["小船沿着河流慢慢前进。", "The small boat moved slowly along the ____."], ["他们坐在河边，听水流的声音。", "They sat beside the ____ and listened to the water."]] },
  letter: { zh: "信；字母", phonetic: "/ˈletər/", kind: "object", sentence: "A letter from home waited on the table.", review: [["她收到一封来自远方朋友的信。", "She received a ____ from a friend far away."], ["爸爸把信投进街角的邮筒。", "Dad put the ____ into the mailbox on the corner."]] },
  quiet: { zh: "安静的", phonetic: "/ˈkwaɪət/", kind: "adjective", sentence: "The library became quiet after the rain.", review: [["老师请大家在图书馆里保持安静。", "The teacher asked everyone to be ____ in the library."], ["清晨的街道很安静，只有鸟在叫。", "The street was ____ in the morning, with only birds singing."]] },
  bright: { zh: "明亮的", phonetic: "/braɪt/", kind: "adjective", sentence: "A bright lamp made the desk easy to see.", review: [["阳光很明亮，照进了厨房。", "The sun was ____ as it came into the kitchen."], ["她选了一盏明亮的灯来读书。", "She chose a ____ lamp for reading."]] },
  coffee: { zh: "咖啡", phonetic: "/ˈkɔːfi/", kind: "object", sentence: "A cup of coffee warmed his hands.", review: [["她在小咖啡馆点了一杯热咖啡。", "She ordered a hot cup of ____ at the small café."], ["桌上放着两杯咖啡。", "Two cups of ____ were on the table."]] },
  train: { zh: "火车", phonetic: "/treɪn/", kind: "object", sentence: "The train left just as the sky turned pink.", review: [["早班火车在六点离开站台。", "The early ____ left the platform at six."], ["他们从窗外看着火车穿过田野。", "They watched the ____ cross the fields from the window."]] },
  map: { zh: "地图", phonetic: "/mæp/", kind: "object", sentence: "The map showed a path beside the lake.", review: [["迷路后，他们打开地图找方向。", "After getting lost, they opened a ____ to find the way."], ["导游在地图上画了一条步行路线。", "The guide drew a walking route on the ____. "]] },
  bread: { zh: "面包", phonetic: "/bred/", kind: "object", sentence: "Fresh bread cooled beside the open window.", review: [["面包店刚烤好一条面包。", "The bakery had just baked a loaf of ____."], ["早餐时，她在面包上涂了黄油。", "At breakfast, she put butter on her ____. "]] },
  friend: { zh: "朋友", phonetic: "/frend/", kind: "person", sentence: "A friend saved a seat beside the door.", review: [["朋友在雨中等了他一会儿。", "A ____ waited for him in the rain."], ["她和朋友分享了一个好消息。", "She shared some good news with her ____. "]] },
  window: { zh: "窗；窗户", phonetic: "/ˈwɪndoʊ/", kind: "object", sentence: "The open window let in a cool breeze.", review: [["她轻轻打开窗户，让新鲜空气进来。", "She opened the ____ to let fresh air in."], ["一只鸟停在窗户外面的树枝上。", "A bird rested on a branch outside the ____. "]] },
  street: { zh: "街道", phonetic: "/striːt/", kind: "place", sentence: "The street shone after the evening rain.", review: [["孩子们在过马路前左右看。", "The children looked both ways before crossing the ____."], ["小店在一条安静的街道上。", "The small shop stood on a quiet ____. "]] },
  music: { zh: "音乐", phonetic: "/ˈmjuːzɪk/", kind: "object", sentence: "Soft music came from the room upstairs.", review: [["房间里传出轻柔的音乐。", "Soft ____ came from the room."], ["他们一边做饭一边听音乐。", "They listened to ____ while cooking."]] },
  morning: { zh: "早晨；上午", phonetic: "/ˈmɔːrnɪŋ/", kind: "time", sentence: "The morning began with pale light and tea.", review: [["早晨的第一缕阳光照在桌上。", "The first light of the ____ fell on the table."], ["他每天早晨都会散步。", "He takes a walk every ____. "]] }
};

let state;
let currentView = "home";
let selectedBatchId = null;
let question = null;
let learnPage = 0;
let revealedTranslations = new Set();
let reviewHistory = [];
let reviewHistoryIndex = null;
let pausedQuestion = null;
let toastTimer = null;
let saving = Promise.resolve();
const LEARNING_PAGE_SIZE = 10;
const WORDS_PAGE_SIZE = 10;
let mistakePage = 0;
let savedPage = 0;
let librarySearch = "";
let savedWordsExpanded = false;
let masteredWordsExpanded = false;
let masteredPage = 0;
let historyCalendarMonth = null;
let wordbookPanelExpanded = false;
const DAILY_QUOTES = [
  ["Small deeds done are better than great deeds planned.", "完成微小的行动，胜过筹划宏大的目标。"],
  ["The future depends on what you do today.", "未来取决于你今天所做的事。"],
  ["A journey of a thousand miles begins with a single step.", "千里之行，始于足下。"],
  ["Little by little, a little becomes a lot.", "一点一滴，终会汇成丰盛。"],
  ["Well begun is half done.", "好的开始，是成功的一半。"],
  ["Patience is bitter, but its fruit is sweet.", "耐心虽苦，果实却甜。"],
  ["What we learn with pleasure, we never forget.", "愉悦中学到的东西，永远不会忘记。"]
];
const WORD_DETAILS = {
  due: { partOfSpeech: "adj. / prep.", currentSense: "到期的；预定的", senses: ["到期的；应付的", "预定发生的", "由于，因为（be due to）"] },
  alleviate: { partOfSpeech: "v.", currentSense: "减轻；缓和", senses: ["减轻（疼痛、压力等）", "缓和，缓解"] },
  weave: { partOfSpeech: "v.", currentSense: "编织", senses: ["编织", "交织", "编造（故事、谎言等）"] },
  drawing: { partOfSpeech: "n.", currentSense: "图画；素描", senses: ["图画；素描", "抽取；提款", "抽签"] },
  snow: { partOfSpeech: "n. / v.", currentSense: "雪；下雪", senses: ["雪", "下雪"] },
  realistic: { partOfSpeech: "adj.", currentSense: "逼真的；切合实际的", senses: ["现实的", "逼真的", "切合实际的"] },
  nevertheless: { partOfSpeech: "adv.", currentSense: "尽管如此；然而", senses: ["尽管如此", "不过；然而"] },
  ride: { partOfSpeech: "v. / n.", currentSense: "骑行；乘坐", senses: ["骑（车、马等）", "乘坐", "骑行；乘车"] },
  expression: { partOfSpeech: "n.", currentSense: "表情；表达", senses: ["表达；措辞", "表情", "数学表达式"] },
  spur: { partOfSpeech: "n. / v.", currentSense: "动力；激励", senses: ["刺激；动力", "马刺", "促进；激励"] },
  clutch: { partOfSpeech: "v. / n.", currentSense: "紧紧抓住", senses: ["紧握；抓住", "离合器", "一窝（蛋等）"] },
  pest: { partOfSpeech: "n.", currentSense: "害虫", senses: ["害虫", "讨厌的人或事物"] },
  standard: { partOfSpeech: "n. / adj.", currentSense: "标准；水准", senses: ["标准；水准", "标准的；合格的"] },
  compass: { partOfSpeech: "n. / v.", currentSense: "指南针", senses: ["指南针", "范围", "包围；环绕"] },
  gloomy: { partOfSpeech: "adj.", currentSense: "阴暗的；忧郁的", senses: ["阴暗的", "忧郁的", "令人沮丧的"] },
  fortunate: { partOfSpeech: "adj.", currentSense: "幸运的", senses: ["幸运的", "带来好运的"] },
  spectacular: { partOfSpeech: "adj.", currentSense: "壮观的；令人惊叹的", senses: ["壮观的", "令人惊叹的"] },
  nutrition: { partOfSpeech: "n.", currentSense: "营养；营养作用", senses: ["营养", "营养作用；营养摄入"] },
  anonymous: { partOfSpeech: "adj.", currentSense: "匿名的；无名的", senses: ["匿名的", "无名的"] },
  pat: { partOfSpeech: "v. / n.", currentSense: "轻拍；拍一拍", senses: ["轻拍", "轻拍声"] }
};
const WORD_USAGE_DETAILS = {
  due: { currentPartOfSpeech: "adj.", otherDefinitions: [{ partOfSpeech: "adj.", sense: "应付的；应得的" }, { partOfSpeech: "prep.", sense: "由于，因为（be due to）" }] },
  alleviate: { currentPartOfSpeech: "v.", otherDefinitions: [] },
  weave: { currentPartOfSpeech: "v.", otherDefinitions: [{ partOfSpeech: "v.", sense: "编造；把情节等编排在一起" }] },
  drawing: { currentPartOfSpeech: "n.", otherDefinitions: [{ partOfSpeech: "n.", sense: "抽取；提款" }, { partOfSpeech: "n.", sense: "抽签" }] },
  snow: { currentPartOfSpeech: "n.", otherDefinitions: [{ partOfSpeech: "v.", sense: "下雪" }] },
  realistic: { currentPartOfSpeech: "adj.", otherDefinitions: [] },
  nevertheless: { currentPartOfSpeech: "adv.", otherDefinitions: [] },
  ride: { currentPartOfSpeech: "v.", otherDefinitions: [{ partOfSpeech: "n.", sense: "骑行；乘车" }] },
  expression: { currentPartOfSpeech: "n.", otherDefinitions: [{ partOfSpeech: "n.", sense: "表达；措辞" }, { partOfSpeech: "n.", sense: "数学表达式" }] },
  spur: { currentPartOfSpeech: "n.", otherDefinitions: [{ partOfSpeech: "n.", sense: "马刺" }, { partOfSpeech: "v.", sense: "刺激；促进" }] },
  clutch: { currentPartOfSpeech: "v.", otherDefinitions: [{ partOfSpeech: "n.", sense: "离合器" }, { partOfSpeech: "n.", sense: "一窝（蛋等）" }] },
  pest: { currentPartOfSpeech: "n.", otherDefinitions: [{ partOfSpeech: "n.", sense: "讨厌的人或事物" }] },
  standard: { currentPartOfSpeech: "n.", otherDefinitions: [{ partOfSpeech: "adj.", sense: "标准的；合格的" }, { partOfSpeech: "n.", sense: "旗帜（正式或军事用语）" }] },
  compass: { currentPartOfSpeech: "n.", otherDefinitions: [{ partOfSpeech: "n.", sense: "范围" }, { partOfSpeech: "v.", sense: "包围；环绕" }] },
  gloomy: { currentPartOfSpeech: "adj.", otherDefinitions: [] },
  fortunate: { currentPartOfSpeech: "adj.", otherDefinitions: [] },
  spectacular: { currentPartOfSpeech: "adj.", otherDefinitions: [] },
  nutrition: { currentPartOfSpeech: "n.", otherDefinitions: [] },
  anonymous: { currentPartOfSpeech: "adj.", otherDefinitions: [] },
  pat: { currentPartOfSpeech: "v.", otherDefinitions: [{ partOfSpeech: "n.", sense: "轻拍；轻拍声" }] }
};
const REVIEW_CONTEXT_DETAILS = {
  due: [["adj.", "到期的；预定的"], ["adj.", "到期的；应付的"]], alleviate: [["v.", "减轻"], ["v.", "缓和"]],
  weave: [["v.", "编织"], ["v.", "交织"]], drawing: [["n.", "图画；素描"], ["n.", "图画；素描"]],
  snow: [["v.", "下雪"], ["n.", "雪"]], realistic: [["adj.", "逼真的"], ["adj.", "切合实际的"]],
  nevertheless: [["adv.", "然而；尽管如此"], ["adv.", "然而；尽管如此"]], ride: [["v.", "骑；骑行"], ["n.", "乘坐；骑行"]],
  expression: [["n.", "表情"], ["n.", "表达；措辞"]], spur: [["v.", "刺激；促进"], ["n.", "动力；刺激"]],
  clutch: [["v.", "紧紧抓住"], ["n.", "离合器"]], pest: [["n.", "害虫"], ["n.", "讨厌的人或事物"]],
  standard: [["n.", "标准；水准"], ["n.", "标准；水准"]], compass: [["n.", "指南针"], ["n.", "范围"]],
  gloomy: [["adj.", "阴暗的"], ["adj.", "忧郁的"]], fortunate: [["adj.", "幸运的"], ["adj.", "幸运的"]],
  spectacular: [["adj.", "壮观的；令人惊叹的"], ["adj.", "壮观的；令人惊叹的"]], nutrition: [["n.", "营养；营养作用"], ["n.", "营养；营养作用"]],
  anonymous: [["adj.", "匿名的；无名的"], ["adj.", "匿名的；无名的"]], pat: [["n.", "轻拍；拍一拍"], ["v.", "轻拍"]]
};

function makeInitialState() { return { version: 1, words: [], batches: [], logs: [], settings: { ...DEFAULT_SETTINGS }, updatedAt: new Date().toISOString() }; }
function id(prefix) { return `${prefix}-${crypto.randomUUID()}`; }
function escapeHtml(value = "") { return String(value).replace(/[&<>'"]/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" })[char]); }
function shuffle(items) { const copy = [...items]; for (let i = copy.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [copy[i], copy[j]] = [copy[j], copy[i]]; } return copy; }
function now() { return new Date(); }
function daysBetween(from, to = now()) { return Math.max(0, (to - new Date(from)) / 86400000); }
function hoursFromNow(hours) { return new Date(Date.now() + hours * 3600000).toISOString(); }
function formatDue(iso) { if (!iso) return "待初学"; const ms = new Date(iso) - now(); if (ms <= 0) return "现在可复习"; const hours = Math.round(ms / 3600000); return hours < 24 ? `${hours} 小时后` : `${Math.round(hours / 24)} 天后`; }
function cardStatus(card) { if (card.stage === "learning") return ["待学习", "learning"]; if (card.stage === "sameDay") return ["待巩固", "learning"]; if (card.stage === "mastered") return ["已掌握", "review"]; return [formatDue(card.dueAt), "review"]; }
function wordData(word) { return CONTENT_LIBRARY[word.text.toLowerCase()] || IMPORTED_WORD_DETAILS[word.text.toLowerCase()] || LEXICON[word.text.toLowerCase()] || {}; }
function wordProfile(word) {
  const base = wordData(word); const detail = WORD_DETAILS[word.text.toLowerCase()] || {}; const usage = WORD_USAGE_DETAILS[word.text.toLowerCase()] || {};
  return {
    partOfSpeech: usage.currentPartOfSpeech || word.partOfSpeech || base.partOfSpeech || detail.partOfSpeech || "词性待补充",
    currentSense: word.currentSense || base.currentSense || detail.currentSense || word.definition || base.zh || "中文释义待补充",
    senses: word.senses?.length ? word.senses : base.senses?.length ? base.senses : detail.senses?.length ? detail.senses : [word.definition || base.zh || "中文释义待补充"],
    otherDefinitions: word.otherDefinitions?.length ? word.otherDefinitions : usage.otherDefinitions || []
  };
}
function hydrateLocalContent() {
  let changed = false;
  state.words.forEach((word) => {
    const base = wordData(word); const detail = WORD_DETAILS[word.text.toLowerCase()] || {}; const usage = WORD_USAGE_DETAILS[word.text.toLowerCase()] || {};
    const fields = { definition: base.zh, phonetic: base.phonetic, sentence: base.sentence, translation: base.translation, partOfSpeech: usage.currentPartOfSpeech || base.partOfSpeech || detail.partOfSpeech, currentSense: base.currentSense || detail.currentSense, senses: base.senses || detail.senses, otherDefinitions: usage.otherDefinitions };
    Object.entries(fields).forEach(([field, value]) => {
      if (!word[field] && value) { word[field] = value; changed = true; }
    });
    if (detail.currentSense && word.currentSense !== detail.currentSense) { word.currentSense = detail.currentSense; changed = true; }
    if (detail.senses && JSON.stringify(word.senses) !== JSON.stringify(detail.senses)) { word.senses = detail.senses; changed = true; }
    if (usage.currentPartOfSpeech && word.partOfSpeech !== usage.currentPartOfSpeech) { word.partOfSpeech = usage.currentPartOfSpeech; changed = true; }
    if (usage.otherDefinitions && JSON.stringify(word.otherDefinitions) !== JSON.stringify(usage.otherDefinitions)) { word.otherDefinitions = usage.otherDefinitions; changed = true; }
    if (word.learningSeen && !word.learnedAt) { const source = word.learningPlanDate ? `${word.learningPlanDate}T12:00:00+08:00` : word.createdAt; if (source) { word.learnedAt = new Date(source).toISOString(); changed = true; } }
  });
  return changed;
}
function beijingDateKey(value = new Date()) {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Shanghai", year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(new Date(value));
  const valueFor = (type) => parts.find((part) => part.type === type)?.value || "";
  return `${valueFor("year")}-${valueFor("month")}-${valueFor("day")}`;
}
function dailyQuote(scope = "home") {
  const [year, month, day] = beijingDateKey().split("-").map(Number);
  const dayNumber = Math.floor(Date.UTC(year, month - 1, day) / 86400000);
  const scopes = ["home", "words", "learn", "review", "settings"];
  const scopeNumber = Math.max(0, scopes.indexOf(scope));
  const [en, zh] = DAILY_QUOTES[(dayNumber + scopeNumber) % DAILY_QUOTES.length];
  return { en, zh };
}
function migrateNotebookState() {
  let changed = false;
  if (!Array.isArray(state.notebooks) || !state.notebooks.length) {
    const notebook = { id: id("notebook"), name: "我的单词本", createdAt: new Date().toISOString(), archivedAt: null };
    state.notebooks = [notebook]; state.activeNotebookId = notebook.id;
    state.words.forEach((word) => { word.notebookId = notebook.id; });
    state.batches.forEach((batch) => { batch.notebookId = notebook.id; });
    return true;
  }
  const available = state.notebooks.filter((notebook) => !notebook.archivedAt);
  if (!available.length) { state.notebooks[0].archivedAt = null; changed = true; }
  const active = state.notebooks.find((notebook) => notebook.id === state.activeNotebookId && !notebook.archivedAt) || state.notebooks.find((notebook) => !notebook.archivedAt);
  if (state.activeNotebookId !== active.id) { state.activeNotebookId = active.id; changed = true; }
  state.words.forEach((word) => { if (!word.notebookId) { word.notebookId = state.activeNotebookId; changed = true; } });
  state.batches.forEach((batch) => { if (!batch.notebookId) { batch.notebookId = state.activeNotebookId; changed = true; } });
  return changed;
}
function activeNotebook() { return state.notebooks.find((notebook) => notebook.id === state.activeNotebookId && !notebook.archivedAt) || state.notebooks.find((notebook) => !notebook.archivedAt) || null; }
function activeWords() { const notebook = activeNotebook(); return notebook ? state.words.filter((word) => word.notebookId === notebook.id) : []; }
function activeLogs() { const ids = new Set(activeWords().map((word) => word.id)); return state.logs.filter((log) => ids.has(log.wordId)); }
function dailyNewCount() { const today = beijingDateKey(); return activeWords().filter((word) => word.learningPlanDate === today).length; }
function learnedDateKey(word) { return word.learnedAt ? beijingDateKey(word.learnedAt) : word.learningSeen ? word.learningPlanDate || (word.createdAt ? beijingDateKey(word.createdAt) : null) : null; }
function learningCountForDate(dateKey) { return activeWords().filter((word) => learnedDateKey(word) === dateKey).length; }
function reviewCountForDate(dateKey) { return activeLogs().filter((log) => beijingDateKey(log.reviewedAt) === dateKey).length; }
function dailyLearnedCount() { return learningCountForDate(beijingDateKey()); }
function dailyReviewCount() { return reviewCountForDate(beijingDateKey()); }
function studyHistoryDays() {
  const dates = new Set();
  activeWords().forEach((word) => { const dateKey = learnedDateKey(word); if (dateKey) dates.add(dateKey); });
  activeLogs().forEach((log) => { if (log.reviewedAt) dates.add(beijingDateKey(log.reviewedAt)); });
  if (!dates.size) dates.add(beijingDateKey());
  const today = beijingDateKey();
  return [...dates].sort((a, b) => b.localeCompare(a)).map((dateKey) => ({ dateKey, learned: learningCountForDate(dateKey), reviewed: reviewCountForDate(dateKey), isToday: dateKey === today }));
}
function monthKey(dateKey = beijingDateKey()) { return String(dateKey).slice(0, 7); }
function shiftMonth(month, offset) { const [year, value] = month.split("-").map(Number); const date = new Date(Date.UTC(year, value - 1 + offset, 1)); return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}`; }
function monthLabel(month) { const [year, value] = month.split("-").map(Number); return `${year}年${value}月`; }
function studyCalendarCells(month, records) {
  const [year, value] = month.split("-").map(Number); const first = new Date(Date.UTC(year, value - 1, 1)); const offset = (first.getUTCDay() + 6) % 7; const count = new Date(Date.UTC(year, value, 0)).getUTCDate(); const recordMap = new Map(records.map((item) => [item.dateKey, item])); const slots = Math.ceil((offset + count) / 7) * 7; const today = beijingDateKey();
  return Array.from({ length: slots }, (_, index) => { const day = index - offset + 1; if (day < 1 || day > count) return null; const dateKey = `${month}-${String(day).padStart(2, "0")}`; const record = recordMap.get(dateKey); return { dateKey, day, learned: record?.learned || 0, reviewed: record?.reviewed || 0, isToday: dateKey === today, hasRecord: Boolean(record) }; });
}
function reviewCurveDays(dayCount = 7) {
  return Array.from({ length: dayCount }, (_, offset) => {
    const dateKey = beijingDateKey(new Date(Date.now() + offset * 86400000));
    const due = activeWords().filter((word) => {
      if (word.stage === "sameDay") return offset === 0;
      if (word.stage !== "review" || !word.dueAt) return false;
      const dueDate = new Date(word.dueAt); return dueDate <= now() ? offset === 0 : beijingDateKey(dueDate) === dateKey;
    }).length;
    return { dateKey, due, isToday: offset === 0 };
  });
}
function shortDate(dateKey) { const [, month, day] = dateKey.split("-"); return `${Number(month)}月${Number(day)}日`; }
function dailyStudyWordsForBatch(batch) {
  if (!batch) return [];
  const today = beijingDateKey(); const target = Math.max(1, Number(state.settings.dailyNewTarget) || 10);
  const batchWords = wordsForBatch(batch); let planned = batchWords.filter((word) => word.learningPlanDate === today);
  if (planned.length < target) {
    const add = batchWords.filter((word) => word.stage === "learning" && word.learningPlanDate !== today).slice(0, target - planned.length);
    if (add.length) { add.forEach((word) => { word.learningPlanDate = today; }); planned = [...planned, ...add]; persist(); }
  }
  return planned;
}
function showToast(message) { TOAST.textContent = message; TOAST.classList.add("is-visible"); clearTimeout(toastTimer); toastTimer = setTimeout(() => TOAST.classList.remove("is-visible"), 2800); }
function applyTheme() { document.documentElement.dataset.theme = state.settings.darkMode ? "dark" : "light"; document.querySelector('meta[name="theme-color"]')?.setAttribute("content", state.settings.darkMode ? "#1c1c1e" : "#f6f4ef"); }
async function load() {
  try {
    const response = await fetch("/api/state", { cache: "no-store" });
    if (!response.ok) throw new Error("无法读取本地数据");
    const payload = await response.json();
    state = payload.state && payload.state.settings ? payload.state : makeInitialState();
    const settingsUpdated = Object.keys(DEFAULT_SETTINGS).some((key) => !(key in state.settings));
    state.settings = { ...DEFAULT_SETTINGS, ...state.settings };
    const removedLegacyAiSettings = ["aiEnabled", "aiEndpoint", "aiModel"].some((key) => key in state.settings);
    ["aiEnabled", "aiEndpoint", "aiModel"].forEach((key) => delete state.settings[key]);
    const notebookUpdated = migrateNotebookState();
    const contentUpdated = hydrateLocalContent();
    document.documentElement.dataset.reduceMotion = String(state.settings.reducedMotion);
    applyTheme();
    selectedBatchId = state.batches.filter((batch) => batch.notebookId === state.activeNotebookId).at(-1)?.id || null;
    render();
    if (contentUpdated || settingsUpdated || notebookUpdated || removedLegacyAiSettings) persist();
    void hydrateOfflineDictionary();
  } catch (error) {
    APP.innerHTML = `<section class="done-state"><p class="eyebrow">本地服务未连接</p><h2>词境还没有启动</h2><p>请在“词境”文件夹运行 <code>npm start</code>，再打开 http://127.0.0.1:4173。数据只会保存到该文件夹内的 data/state.json。</p></section>`;
  }
}
function persist() {
  state.updatedAt = new Date().toISOString();
  saving = saving.catch(() => undefined).then(async () => {
    const response = await fetch("/api/state", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ state }) });
    if (!response.ok) throw new Error("保存失败");
  }).catch((error) => showToast(`本地保存失败：${error.message}`));
  return saving;
}
function navigate(view) { currentView = view; question = null; window.location.hash = view; render(); APP.focus({ preventScroll: true }); window.scrollTo({ top: 0, behavior: state.settings.reducedMotion ? "auto" : "smooth" }); }
function getBatch() { const batches = state.batches.filter((batch) => batch.notebookId === state.activeNotebookId); return batches.find((batch) => batch.id === selectedBatchId) || batches.at(-1) || null; }
function wordsForBatch(batch) { return batch ? batch.wordIds.map((wordId) => state.words.find((word) => word.id === wordId && word.notebookId === state.activeNotebookId)).filter(Boolean) : []; }
function queue() {
  const remaining = Math.max(0, (Number(state.settings.dailyReviewTarget) || 30) - dailyReviewCount());
  return activeWords().filter((word) => word.stage === "sameDay" || (word.stage === "review" && word.dueAt && new Date(word.dueAt) <= now())).sort((a, b) => (a.dueAt || "").localeCompare(b.dueAt || "")).slice(0, remaining);
}
function dueCount() { return queue().length; }
function isGateClosed() { return activeWords().filter((word) => word.stage === "review" && word.dueAt && new Date(word.dueAt) <= now()).length >= state.settings.reviewGate; }
function incompleteCount() { return activeWords().filter((word) => word.stage === "learning").length; }
function renderNav() {
  document.querySelectorAll("[data-nav]").forEach((button) => button.classList.toggle("is-active", button.dataset.nav === currentView));
  const count = document.querySelector("#review-count"); const total = dueCount(); count.textContent = total; count.dataset.zero = String(total === 0);
  const themeButton = document.querySelector("[data-toggle-theme]");
  if (themeButton) { themeButton.textContent = state.settings.darkMode ? "日间" : "夜间"; themeButton.setAttribute("aria-label", state.settings.darkMode ? "切换到日间模式" : "切换到夜间模式"); }
}
function pageHeading(title) { const quote = dailyQuote({ "词表": "words", "学习": "learn", "复习": "review", "设置": "settings" }[title] || "home"); return `<div class="page-heading"><div><h1>${title}</h1><p class="daily-quote"><span>${quote.en}</span><em>${quote.zh}</em></p></div></div>`; }

function renderHome() {
  const due = dueCount(); const learning = incompleteCount(); const total = activeWords().length; const completed = activeLogs().length; const quote = dailyQuote("home"); const studyDays = studyHistoryDays(); const curveDays = reviewCurveDays();
  const primaryView = due ? "review" : learning ? "learn" : total ? "words" : "words";
  const primaryLabel = due ? `开始复习 · ${due} 词` : learning ? `继续学习 · ${learning} 词` : total ? "查看词表" : "导入一小批词";
  const message = due ? `今天，重新遇见 <em>${due}</em> 个词。` : learning ? `让 <em>${learning}</em> 个词进入语境。` : total ? "此刻，没有到期的复习。" : "从一小批词开始。";
  APP.innerHTML = `<section class="home-page"><p class="eyebrow">${escapeHtml(activeNotebook()?.name || "我的单词本")} · 本地学习</p><h1 class="display">${message}</h1><p class="lede daily-home-quote"><span>${quote.en}</span><em>${quote.zh}</em></p><div class="action-row"><button class="primary" data-go="${primaryView}">${primaryLabel}</button>${total ? `<button class="secondary" data-go="words">管理词表</button>` : `<button class="secondary" data-demo>载入示例 20 词</button>`}</div><div class="home-shelf"><section><p class="section-label">今日节奏 · 北京时间</p>${taskCard("学习", `${dailyLearnedCount()} / ${state.settings.dailyNewTarget} 词已学习。`, "learn", "继续")}${taskCard("复习", `${dailyReviewCount()} / ${state.settings.dailyReviewTarget} 词已完成复习。`, "review", "开始")}</section><aside><p class="section-label">当前单词本</p><dl class="stat-list"><div><dt>词表中的词</dt><dd>${total}</dd></div><div><dt>已完成的复习</dt><dd>${completed}</dd></div><div><dt>目标记忆率</dt><dd>${Math.round(state.settings.targetRetention * 100)}%</dd></div></dl></aside></div><div class="home-insights"><section class="home-insight memory-curve"><div class="insight-heading"><div><p class="section-label">间隔复习</p><h2>记忆曲线</h2></div><span>未来 7 天</span></div><ol class="curve-days">${curveDays.map((item) => `<li class="${item.isToday ? "is-today" : ""}"><time datetime="${item.dateKey}">${item.isToday ? "今天" : shortDate(item.dateKey)}</time><strong>${item.due}</strong><small>待复习</small></li>`).join("")}</ol></section><section class="home-insight study-history"><div class="insight-heading"><div><p class="section-label">学习记录</p><h2>每日学习与复习</h2></div><span>全部 ${studyDays.length} 天</span></div><ol class="activity-days">${studyDays.map((item) => `<li class="${item.isToday ? "is-today" : ""}"><time datetime="${item.dateKey}"><b>${item.isToday ? "今天" : shortDate(item.dateKey)}</b><span>${item.dateKey}</span></time><p><strong>学 ${item.learned}</strong><strong>复 ${item.reviewed}</strong></p></li>`).join("")}</ol></section></div></section>`;
  const currentMonth = monthKey(); const earliestMonth = monthKey(studyDays.at(-1)?.dateKey || currentMonth);
  if (!historyCalendarMonth || historyCalendarMonth < earliestMonth || historyCalendarMonth > currentMonth) historyCalendarMonth = currentMonth;
  const calendarCells = studyCalendarCells(historyCalendarMonth, studyDays);
  APP.querySelector(".study-history").innerHTML = `<div class="insight-heading"><div><p class="section-label">学习记录</p><h2>学习日历</h2></div><span>全部 ${studyDays.length} 天</span></div><div class="calendar-toolbar"><button class="quiet-button" data-history-month="-1" ${historyCalendarMonth <= earliestMonth ? "disabled" : ""}>← 上月</button><strong>${monthLabel(historyCalendarMonth)}</strong><button class="quiet-button" data-history-month="1" ${historyCalendarMonth >= currentMonth ? "disabled" : ""}>下月 →</button></div><ol class="calendar-weekdays"><li>一</li><li>二</li><li>三</li><li>四</li><li>五</li><li>六</li><li>日</li></ol><ol class="study-calendar">${calendarCells.map((item) => item ? `<li class="${item.isToday ? "is-today" : ""} ${item.hasRecord ? "has-record" : ""}"><time datetime="${item.dateKey}">${item.day}</time>${item.hasRecord ? `<span>学 ${item.learned}</span><span>复 ${item.reviewed}</span>` : ""}</li>` : `<li class="is-empty" aria-hidden="true"></li>`).join("")}</ol>`;
}
function taskCard(title, copy, go, action) { return `<article class="task-card"><h3>${title}</h3><p>${copy}</p><button class="task-link" data-go="${go}">${action} →</button></article>`; }

function allDefinitions(word) {
  const profile = wordProfile(word);
  const definitions = [{ partOfSpeech: profile.partOfSpeech, sense: profile.currentSense }, ...profile.otherDefinitions];
  return definitions.filter((item, index, list) => item.sense && list.findIndex((candidate) => candidate.partOfSpeech === item.partOfSpeech && candidate.sense === item.sense) === index);
}
function definitionList(word) { return allDefinitions(word).map((item) => `<li><span>${escapeHtml(item.partOfSpeech)}</span>${escapeHtml(item.sense)}</li>`).join(""); }
function regionPager(region, page, pageCount) {
  return `<div class="region-pager"><button class="quiet-button" data-${region}-page="${page - 1}" ${page === 0 ? "disabled" : ""}>上一页</button><span>第 ${page + 1} / ${pageCount} 页</span><button class="quiet-button" data-${region}-page="${page + 1}" ${page === pageCount - 1 ? "disabled" : ""}>下一页</button></div>`;
}
function allDefinitionEntries(word) {
  const profile = wordProfile(word); const usage = WORD_USAGE_DETAILS[word.text.toLowerCase()] || {}; const other = profile.otherDefinitions || [];
  const normalized = (value) => String(value || "").replace(/[；;、，,（）()\s]/g, "");
  const otherValues = other.map((item) => normalized(item.sense));
  const primarySenses = (profile.senses || []).filter((sense) => !otherValues.includes(normalized(sense)));
  const primary = primarySenses.join("；") || profile.currentSense || word.definition || "中文释义待补充";
  const entries = [{ partOfSpeech: usage.currentPartOfSpeech || profile.partOfSpeech, sense: primary }, ...other];
  const unique = new Set();
  return entries.filter((entry) => {
    const key = `${entry.partOfSpeech}|${normalized(entry.sense)}`;
    if (!entry.sense || unique.has(key)) return false; unique.add(key); return true;
  });
}
function wordLibraryCard(word, mistakeCount = 0) {
  const definitions = allDefinitionEntries(word);
  return `<button class="word-library-item" data-speak-word="${word.id}" aria-label="朗读 ${escapeHtml(word.text)}"><span class="word-library-term">${escapeHtml(word.text)}</span><span class="word-library-definitions">${definitions.map((entry) => `<span class="word-library-meaning"><b>${escapeHtml(entry.partOfSpeech || "")}</b>${escapeHtml(entry.sense)}</span>`).join("")}</span>${mistakeCount ? `<small>错 ${mistakeCount} 次</small>` : ""}</button>`;
}
function masteredWordRow(word) { return `<div class="mastered-word-row">${wordLibraryCard(word)}<button class="mastered-word-delete" data-delete-mastered-word="${word.id}" aria-label="从词库删除 ${escapeHtml(word.text)}">删除</button></div>`; }
function matchesWordLibrarySearch(word, query) {
  const needle = String(query || "").trim().toLowerCase();
  return !needle || word.text.toLowerCase().includes(needle);
}
function renderWords() {
  let words = activeWords(); const notebook = activeNotebook(); const mistakeCounts = new Map(); const searching = Boolean(librarySearch.trim());
  const notebookOptions = state.notebooks.filter((item) => !item.archivedAt).map((item) => `<option value="${item.id}" ${item.id === notebook?.id ? "selected" : ""}>${escapeHtml(item.name)}</option>`).join("");
  activeLogs().filter((log) => !log.correct).forEach((log) => mistakeCounts.set(log.wordId, (mistakeCounts.get(log.wordId) || 0) + 1));
  let mistakeWords = words.filter((word) => mistakeCounts.has(word.id)).sort((a, b) => mistakeCounts.get(b.id) - mistakeCounts.get(a.id) || a.text.localeCompare(b.text));
  mistakeWords = mistakeWords.filter((word) => matchesWordLibrarySearch(word, librarySearch));
  const masteredWords = words.filter((word) => word.stage === "mastered" && matchesWordLibrarySearch(word, librarySearch)).sort((a, b) => a.text.localeCompare(b.text));
  const savedMatches = words.filter((word) => word.stage !== "mastered" && matchesWordLibrarySearch(word, librarySearch));
  const preferMistakes = searching && mistakeWords.length > 0;
  const preferSaved = searching && !preferMistakes && savedMatches.length > 0;
  const preferMastered = searching && !preferMistakes && !preferSaved && masteredWords.length > 0;
  words = preferMistakes || preferMastered ? [] : savedMatches;
  if (searching && (preferSaved || (!preferMistakes && !preferMastered))) savedWordsExpanded = true;
  if (searching && preferMastered) masteredWordsExpanded = true;
  const mistakePages = Math.max(1, Math.ceil(mistakeWords.length / WORDS_PAGE_SIZE)); mistakePage = Math.max(0, Math.min(mistakePage, mistakePages - 1));
  const savedPages = Math.max(1, Math.ceil(words.length / WORDS_PAGE_SIZE)); savedPage = Math.max(0, Math.min(savedPage, savedPages - 1));
  const masteredPages = Math.max(1, Math.ceil(masteredWords.length / WORDS_PAGE_SIZE)); masteredPage = Math.max(0, Math.min(masteredPage, masteredPages - 1));
  const mistakeList = mistakeWords.length ? mistakeWords.slice(mistakePage * WORDS_PAGE_SIZE, (mistakePage + 1) * WORDS_PAGE_SIZE).map((word) => wordLibraryCard(word, mistakeCounts.get(word.id))).join("") : `<div class="empty compact-empty">${searching ? "错词库中没有匹配的单词。" : "还没有错词记录。"}</div>`;
  const savedList = words.length ? words.slice(savedPage * WORDS_PAGE_SIZE, (savedPage + 1) * WORDS_PAGE_SIZE).map((word) => wordLibraryCard(word)).join("") : `<div class="empty compact-empty">${searching ? "已保存的词中没有匹配的单词。" : "这个单词本还没有内容。"}</div>`;
  const masteredList = masteredWords.length ? masteredWords.slice(masteredPage * WORDS_PAGE_SIZE, (masteredPage + 1) * WORDS_PAGE_SIZE).map(masteredWordRow).join("") : `<div class="empty compact-empty">${searching ? "已掌握的词中没有匹配的单词。" : "还没有达到已掌握标准的单词。"}</div>`;
  APP.innerHTML = `<section>${pageHeading("词表")}<section class="wordbook-quick"><button class="wordbook-quick-toggle" data-toggle-wordbook-panel aria-expanded="${wordbookPanelExpanded}"><span>当前单词本 · <strong>${escapeHtml(notebook?.name || "我的单词本")}</strong></span><span>${wordbookPanelExpanded ? "收起" : "切换或新建"}⌄</span></button>${wordbookPanelExpanded ? `<div class="wordbook-quick-content"><label>导入到 <select data-active-notebook aria-label="导入目标单词本">${notebookOptions}</select></label><div><input id="new-notebook-name" placeholder="新单词本名称" maxlength="40" aria-label="新单词本名称" /><button class="secondary" data-create-notebook>新建单词本</button></div><button class="quiet-button" data-go="settings">归档和删除管理</button></div>` : ""}</section><div class="import-panel"><div><label class="field-label" for="word-input">粘贴英文单词</label><textarea id="word-input" placeholder="bank\nbridge\nticket\nbook"></textarea><div class="action-row"><button class="primary" data-import>导入这一批</button><label class="secondary" for="txt-file">导入文件</label><input id="txt-file" data-file-input type="file" accept=".txt,.pdf,.docx,.xlsx,.xlsm,text/plain,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/vnd.ms-excel.sheet.macroEnabled.12" hidden /></div><p class="tiny">支持 TXT、PDF、Word、Excel（.xlsx / .xlsm）；只提取英文单词，文件不会保存或上传。</p></div><aside class="import-aside"><h3>导入到当前单词本</h3><p>切换或新建单词本后，下面的导入内容会直接进入该单词本。</p><button class="secondary" data-demo>载入示例 20 词</button></aside></div><section class="word-library mistake-library"><div class="word-library-heading"><div><p class="section-label">复习记录</p><h2>错词库 <span>${mistakeWords.length} 词</span></h2></div><p>按错误次数排序</p></div><div class="word-library-grid">${mistakeList}</div>${mistakeWords.length ? regionPager("mistake", mistakePage, mistakePages) : ""}</section><section class="word-library saved-library"><button class="word-library-toggle" data-toggle-saved-words aria-expanded="${savedWordsExpanded}"><span><span class="section-label">本地词表</span><strong>已保存的词 <i>${words.length}</i></strong></span><span>${savedWordsExpanded ? "收起" : "展开"}⌄</span></button>${savedWordsExpanded ? `<div class="word-library-grid">${savedList}</div>${words.length ? regionPager("saved", savedPage, savedPages) : ""}` : ""}</section></section>`;
  APP.querySelector(".import-aside")?.remove();
  APP.querySelector(".mistake-library")?.insertAdjacentHTML("afterend", `<section class="word-library mastered-library"><button class="word-library-toggle" data-toggle-mastered-words aria-expanded="${masteredWordsExpanded || preferMastered}"><span><span class="section-label">复习成果</span><strong>已掌握的词 <i>${masteredWords.length}</i></strong></span><span>${masteredWordsExpanded || preferMastered ? "收起" : "展开"}⌄</span></button>${masteredWordsExpanded || preferMastered ? `<div class="word-library-grid mastered-word-grid">${masteredList}</div>${masteredWords.length ? regionPager("mastered", masteredPage, masteredPages) : ""}` : ""}</section>`);
  APP.querySelector(".import-panel")?.insertAdjacentHTML("afterend", `<label class="word-library-search library-search"><span>搜索单词</span><input data-library-search="all" value="${escapeHtml(librarySearch)}" placeholder="输入英文单词" autocomplete="off" />${searching ? `<small class="library-search-result">${preferMistakes ? "已优先显示错词库" : preferSaved ? "显示已保存的词" : preferMastered ? "显示已掌握的词" : "没有匹配的单词"}</small>` : ""}</label>`);
  const masteredLibrary = APP.querySelector(".mastered-library");
  if (searching && preferMistakes) { APP.querySelector(".saved-library")?.remove(); masteredLibrary?.remove(); }
  else if (searching && preferSaved) { APP.querySelector(".mistake-library")?.remove(); masteredLibrary?.remove(); }
  else if (searching && preferMastered) { APP.querySelector(".mistake-library")?.remove(); APP.querySelector(".saved-library")?.remove(); }
  else if (searching) { APP.querySelector(".mistake-library")?.remove(); masteredLibrary?.remove(); }
}

function textWithToken(sentence, word) { const escapedSentence = escapeHtml(sentence); const needle = escapeHtml(word); const index = escapedSentence.toLowerCase().indexOf(needle.toLowerCase()); if (index < 0) return escapedSentence; return `${escapedSentence.slice(0, index)}<button class="word-token" data-popover-word="${escapeHtml(word)}">${escapedSentence.slice(index, index + needle.length)}</button>${escapedSentence.slice(index + needle.length)}`; }
function fallbackLearningLine(word, index) {
  const variants = [
    [`At the beginning of the day, ${word.text} becomes important in this small scene.`, `在一天刚开始时，${word.text} 成为这个小场景里的重点词。`],
    [`Near the open window, ${word.text} appears in a different moment.`, `在打开的窗边，${word.text} 出现在一个不同的时刻。`],
    [`In this quiet exchange, the word to notice is ${word.text}.`, `在这段安静的交流里，需要注意的词是 ${word.text}。`],
    [`A new detail changes the scene: ${word.text} now matters here.`, `一个新细节改变了场景：这里的 ${word.text} 变得重要。`],
    [`Before the story ends, we meet ${word.text} in its own place.`, `故事结束前，我们在它自己的位置上遇见 ${word.text}。`]
  ];
  const chosen = variants[index % variants.length];
  return { sentence: chosen[0], translation: chosen[1] };
}
function storyLine(word, index) {
  const base = wordData(word); const fallback = fallbackLearningLine(word, index); const sentence = word.sentence || base.sentence || fallback.sentence; const translation = word.translation || base.translation || fallback.translation;
  return `<div class="story-unit" id="learning-word-${word.id}" style="--line-index:${index}"><p class="story-line">${textWithToken(sentence, word.text)}<button class="speaker" data-speak-sentence="${escapeHtml(sentence)}" aria-label="朗读这一句">${SPEAKER_ICON}</button></p><div class="story-actions"><button class="translation-toggle" data-show-translation="${word.id}">查看句子意思</button></div><p class="story-translation" data-translation-panel="${word.id}">${escapeHtml(translation)}</p></div>`;
}
function renderLearn() {
  const batch = getBatch(); const batchWords = dailyStudyWordsForBatch(batch);
  if (!batch || !batchWords.length) { APP.innerHTML = `<section class="done-state"><p class="eyebrow">学习</p><h2>先选一小批词。</h2><div class="action-row"><button class="primary" data-go="words">去导入词表</button></div></section>`; return; }
  const pageCount = Math.max(1, Math.ceil(batchWords.length / LEARNING_PAGE_SIZE)); learnPage = Math.max(0, Math.min(learnPage, pageCount - 1));
  const pageWords = batchWords.slice(learnPage * LEARNING_PAGE_SIZE, (learnPage + 1) * LEARNING_PAGE_SIZE); const viewed = batchWords.filter((word) => word.learningSeen).length; const missing = batchWords.filter((word) => !word.definition).length;
  const ready = batchWords.some((word) => word.stage === "learning");
  const sidebar = pageWords.map((word) => `<button class="learning-word-nav ${word.learningSeen ? "is-seen" : ""}" data-jump-word="${word.id}"><strong>${escapeHtml(word.text)}</strong><span data-learning-status="${word.id}">${word.learningSeen ? "已学习" : "未学习"}</span></button>`).join("");
  const pageButtons = `<div class="learn-pagination"><button class="secondary" data-learn-page="${learnPage - 1}" ${learnPage === 0 ? "disabled" : ""}>上一页</button><span>第 ${learnPage + 1} / ${pageCount} 页 · ${pageWords.length} 词</span><button class="secondary" data-learn-page="${learnPage + 1}" ${learnPage === pageCount - 1 ? "disabled" : ""}>下一页</button></div>`;
  APP.innerHTML = `<section class="learning-page">${pageHeading("学习")}<div class="daily-progress-line">今日已学习 <strong>${dailyLearnedCount()} / ${dailyNewCount()}</strong> 个单词</div><div class="batch-select">${state.batches.filter((item) => item.notebookId === state.activeNotebookId).map((item, index) => `<button class="batch-chip ${item.id === batch.id ? "is-active" : ""}" data-select-batch="${item.id}">第 ${index + 1} 批 · ${item.wordIds.length} 词</button>`).join("")}</div><div class="learn-workspace"><aside class="learning-sidebar"><p class="section-label">本页词表</p><p class="learning-summary" data-learning-summary>已学习 <strong>${viewed}</strong> / ${batchWords.length}</p><div class="learning-word-list">${sidebar}</div>${pageButtons}</aside><article class="reading-sheet"><p class="reading-kicker">${ready ? "学习语境" : "完成初学"}</p><h2 class="story-title">Learn at your own pace.</h2>${pageWords.map((word, index) => storyLine(word, index)).join("")}<footer class="story-footer"><span class="note">${missing ? `还有 ${missing} 个词缺少中文释义。` : "点击单词会记录这一个词已经学习过。"}</span>${ready ? `<button class="primary" data-complete-learning>完成初学，进入当日巩固</button>` : `<button class="secondary" data-go="review">前往复习</button>`}</footer>${pageButtons}</article></div></section>`;
}

function fallbackContext(word, ordinal) {
  const people = ["Mina", "Owen", "Lena", "Noah", "Iris", "Eli", "Sara", "Leo", "Nora", "Kai", "Emma", "Miles"];
  const places = ["community library", "train station", "school garden", "corner bakery", "small museum", "riverside park", "music room", "post office", "sports hall", "market entrance", "art studio", "neighborhood clinic"];
  const moments = ["the morning meeting", "the afternoon class", "the evening event", "the weekend visit", "the next lesson", "the opening time", "the final check", "the lunch break", "the rainy afternoon", "the first rehearsal", "the short walk home", "the early shift"];
  const person = people[ordinal % people.length]; const place = places[Math.floor(ordinal / people.length) % places.length]; const moment = moments[Math.floor(ordinal / (people.length * places.length)) % moments.length];
  const part = wordProfile(word).partOfSpeech;
  const kind = wordData(word).kind || (/^v\./.test(part) ? "action" : /^adj\./.test(part) ? "adjective" : /^adv\./.test(part) ? "connector" : "object");
  const templates = {
    action: [`在${place}，${person}要在${moment}前完成这个动作。`, `At the ${place}, ${person} had to ____ before ${moment}.`],
    adjective: [`在${place}，${person}觉得新安排在${moment}前显得很贴切。`, `At the ${place}, ${person} said the new plan looked ____ before ${moment}.`],
    connector: [`${person}本想离开${place}；不过${moment}前还有事情没有结束。`, `${person} wanted to leave the ${place}; ____, the work was not finished before ${moment}.`],
    object: [`${person}在${place}的入口附近注意到了这个东西，那时正是${moment}。`, `At the ${place}, ${person} noticed the ____ near the entrance before ${moment}.`]
  };
  const [zh, sentence] = templates[kind] || templates.object;
  return { sceneId: `generated-${ordinal}`, zh, sentence };
}
function contextTextKey(context) { return `${String(context.zh || "").toLowerCase()}|${String(context.sentence || "").toLowerCase()}`.replace(/\s+/g, " ").trim(); }
function createQuestion(word) {
  const used = new Set(word.contexts.map((item) => item.sceneId)); const entries = wordData(word).review || [];
  let foundIndex = entries.findIndex((_, index) => !used.has(`library-${index}`));
  let context;
  if (foundIndex >= 0) { const detail = REVIEW_CONTEXT_DETAILS[word.text.toLowerCase()]?.[foundIndex] || [wordProfile(word).partOfSpeech, wordProfile(word).currentSense]; context = { sceneId: `library-${foundIndex}`, zh: entries[foundIndex][0], sentence: entries[foundIndex][1], contextPartOfSpeech: detail[0], contextSense: detail[1] }; }
  else { const profile = wordProfile(word); const history = new Set(word.contexts.map(contextTextKey)); let ordinal = word.contexts.length; do { context = fallbackContext(word, ordinal); ordinal += 1; } while (history.has(contextTextKey(context)) && ordinal < word.contexts.length + 200); context = { ...context, contextPartOfSpeech: profile.partOfSpeech, contextSense: profile.currentSense }; }
  const kind = wordData(word).kind || "other";
  const alternatives = shuffle(activeWords().filter((candidate) => candidate.id !== word.id && (wordData(candidate).kind === kind || kind === "other")).map((candidate) => candidate.text));
  const spare = shuffle(activeWords().filter((candidate) => candidate.id !== word.id).map((candidate) => candidate.text));
  const answers = []; for (const item of [...alternatives, ...spare]) if (!answers.includes(item)) answers.push(item); while (answers.length < 3) answers.push(["bridge", "ticket", "book"].find((item) => item !== word.text && !answers.includes(item)) || "word");
  return { wordId: word.id, ...context, options: shuffle([word.text, ...answers.slice(0, 3)]), showingOptions: false, hintUsed: false, answered: false, selected: null, startedAt: Date.now() };
}
function getQuestion() { if (!question) { const card = queue()[0]; if (card) question = createQuestion(card); } return question; }
function renderReview() {
  const items = queue(); const isHistorical = Boolean(question?.historical);
  if (!items.length && !isHistorical) { APP.innerHTML = `<section class="done-state"><p class="eyebrow">复习</p><h2>此刻，已经足够。</h2><p>没有到期的词需要复习。完成初学后，当日巩固会出现在这里；之后由 FSRS 根据实际作答安排下一次相遇。</p><div class="action-row">${reviewHistory.length ? `<button class="secondary" data-previous-question>上一题</button>` : ""}${incompleteCount() ? `<button class="primary" data-go="learn">继续学习</button>` : `<button class="secondary" data-go="words">查看词表</button>`}</div></section>`; return; }
  const item = getQuestion(); const card = state.words.find((word) => word.id === item.wordId); const isSameDay = card.stage === "sameDay"; const memory = memoryState(card); const blank = escapeHtml(item.sentence).replace("____", '<span class="cloze-blank">&nbsp;</span>');
  let bottom = `<p class="recall-prompt">先在心里回忆，再决定要不要验证答案。</p><div class="action-row"><button class="primary" data-reveal="false">我想起来了，验证答案</button><button class="quiet-button" data-reveal="true">显示候选（使用提示）</button></div>`;
  if (item.showingOptions) { const choices = item.options.map((option, index) => { const optionWord = activeWords().find((word) => word.text === option) || { text: option }; const profile = wordProfile(optionWord); const isCorrect = item.answered && option === card.text; const isWrongSelection = item.answered && option === item.selected && option !== card.text; const isExpanded = isCorrect || isWrongSelection; const meaning = isCorrect ? { partOfSpeech: item.contextPartOfSpeech || profile.partOfSpeech, currentSense: item.contextSense || profile.currentSense } : profile; const speaker = optionWord.id ? `data-speak-word="${optionWord.id}"` : `data-speak-text="${escapeHtml(option)}"`; return `<article class="choice ${isCorrect ? "is-correct" : ""} ${isWrongSelection ? "is-wrong" : ""}"><button class="choice-select" data-choice="${escapeHtml(option)}" ${item.answered ? "disabled" : ""}><span class="key">${index + 1}</span><span class="choice-label">${escapeHtml(option)}</span>${isCorrect ? `<span class="choice-result">正确</span>` : isWrongSelection ? `<span class="choice-result">错误</span>` : ""}</button>${isExpanded ? `<div class="choice-detail"><div><span class="choice-pos">${escapeHtml(meaning.partOfSpeech)}</span><span class="choice-meaning">${escapeHtml(meaning.currentSense)}</span></div><button class="speaker choice-speaker" ${speaker} aria-label="朗读 ${escapeHtml(option)}">${SPEAKER_ICON}</button></div>` : ""}</article>`; }).join(""); bottom = `<div class="choices">${choices}</div>${item.answered ? answerPanel(card, item) : `<p class="recall-prompt">选择最合适的词。${item.hintUsed ? " 已记录为使用提示。" : ""}</p>`}`; }
  APP.innerHTML = `<section class="review-layout"><div class="review-progress"><span><i class="dot"></i>${isHistorical ? `回看第 ${(reviewHistoryIndex ?? 0) + 1} 题` : isSameDay ? "当日巩固" : "到期复习"}</span><span>${isHistorical ? "不会重复计分" : `待完成 ${items.length} 词`}</span></div><article class="review-card"><div class="review-card-nav"><button class="quiet-button" data-previous-question ${reviewHistory.length ? "" : "disabled"}>← 上一题</button>${isHistorical ? `<button class="quiet-button" data-next-question>回到当前题 →</button>` : ""}</div><p class="review-kind">${isSameDay ? "新的情境 · 当日巩固" : "新的情境 · 回忆优先"}</p><p class="scene-cn">${escapeHtml(item.zh)}</p><h1 class="cloze">${blank}<button class="speaker" data-speak-sentence="${escapeHtml(item.sentence.replace("____", card.text))}" aria-label="朗读例句">${SPEAKER_ICON}</button></h1>${bottom}</article></section>`;
  APP.querySelector(".review-kind")?.insertAdjacentHTML("afterend", reviewMemoryPanel(card, memory));
}
function answerPanel(card, item) {
  const correct = item.selected === card.text; const grade = correct ? (item.hintUsed ? 2 : 3) : 1;
  const label = correct ? (item.hintUsed ? "答对了，且使用了候选提示。" : "答对了，这次回忆很清晰。") : "这次没有选对。已把它带回更短的间隔。";
  const result = item.memoryResult || { before: memoryState(card), interval: card.dueAt ? Math.max(0, daysBetween(now(), card.dueAt)) : null, nextDueAt: card.dueAt, targetRetention: state.settings.targetRetention };
  const beforeRetention = result.before?.hasReview ? `${Math.round(result.before.retrievability * 100)}%` : "首次巩固";
  const nextDate = result.nextDueAt ? formatReviewDate(result.nextDueAt) : "稍后";
  return `<div class="review-answer ${correct ? "answer-correct" : "answer-wrong"}"><strong>${label}</strong><p>本句义项：${escapeHtml(item.contextSense || wordProfile(card).currentSense)}</p><div class="memory-outcome"><span>本次前保持率 <b>${beforeRetention}</b></span><span>下次间隔 <b>${formatInterval(result.interval)}</b></span><span>下次复习 <b>${nextDate}</b></span></div><div class="rating-line"><span class="rating ${grade === 1 ? "is-selected" : ""}">遗忘 · 缩短间隔</span><span class="rating ${grade === 2 ? "is-selected" : ""}">提示后答对</span><span class="rating ${grade === 3 ? "is-selected" : ""}">直接答对 · 延长间隔</span></div><div class="action-row"><button class="primary" data-next-question>${item.historical ? "回到当前题" : "下一题"} <span class="tiny">Enter</span></button></div></div>`;
}

function renderSettings() {
  const voices = enUsVoices(); const voiceOptions = voices.length ? voices.map((voice) => `<option value="${escapeHtml(voice.voiceURI)}" ${voice.voiceURI === state.settings.voiceURI ? "selected" : ""}>${escapeHtml(voice.name)} · ${voice.lang}</option>`).join("") : `<option value="">没有检测到 en-US 声音</option>`;
  const notebooks = state.notebooks.filter((notebook) => !notebook.archivedAt); const archived = state.notebooks.filter((notebook) => notebook.archivedAt); const current = activeNotebook();
  const notebookOptions = notebooks.map((notebook) => `<option value="${notebook.id}" ${notebook.id === current?.id ? "selected" : ""}>${escapeHtml(notebook.name)} · ${state.words.filter((word) => word.notebookId === notebook.id).length} 词</option>`).join("");
  const archivedRows = archived.length ? `<div class="archived-books">${archived.map((notebook) => `<div><span>${escapeHtml(notebook.name)} · ${state.words.filter((word) => word.notebookId === notebook.id).length} 词</span><button class="quiet-button" data-restore-notebook="${notebook.id}">恢复</button><button class="quiet-button danger-button" data-delete-notebook="${notebook.id}">彻底删除</button></div>`).join("")}</div>` : "";
  const sectionLabels = ["单词本", "今日计划", "美式发音", "显示与动效"];
  APP.innerHTML = `<section>${pageHeading("设置")}<div class="settings-grid settings-workspace"><aside class="settings-sidebar"><nav class="settings-toc" aria-label="设置目录"><p>设置目录</p>${sectionLabels.map((label, index) => `<button class="settings-toc-link" data-scroll-setting="${index}">${label}</button>`).join("")}</nav></aside><div class="settings-content"><section class="setting-group"><h2>单词本</h2><div class="setting-stack"><label class="field-label">当前单词本 <select data-active-notebook aria-label="当前单词本">${notebookOptions}</select></label><div class="notebook-create"><input id="new-notebook-name" placeholder="例如：雅思核心词" maxlength="40" aria-label="新单词本名称" /><button class="secondary" data-create-notebook>新建单词本</button></div><div class="notebook-actions"><button class="secondary" data-archive-notebook="${current?.id}">归档并保留学习记录</button><button class="quiet-button danger-button" data-delete-notebook="${current?.id}">彻底删除词与学习记录</button></div>${archivedRows}</div></section><section class="setting-group"><h2>今日计划</h2><div class="setting-stack"><label class="field-label">每日新学 <input data-number-setting="dailyNewTarget" type="number" min="1" max="200" step="1" value="${state.settings.dailyNewTarget}" /></label><label class="field-label">每日复习 <input data-number-setting="dailyReviewTarget" type="number" min="1" max="500" step="1" value="${state.settings.dailyReviewTarget}" /></label></div></section><section class="setting-group"><h2>美式发音</h2><div class="setting-stack"><select data-setting="voiceURI" aria-label="美式英语声音">${voiceOptions}</select><label class="field-label">单词语速 <input data-number-setting="wordRate" type="number" min="0.5" max="1.1" step="0.05" value="${state.settings.wordRate}" /></label><label class="field-label">句子语速 <input data-number-setting="sentenceRate" type="number" min="0.6" max="1.2" step="0.05" value="${state.settings.sentenceRate}" /></label><div><button class="secondary" data-test-voice>试听美式发音</button></div></div></section><section class="setting-group"><h2>显示与动效</h2><div class="setting-stack"><label class="check-row"><input data-checkbox-setting="darkMode" type="checkbox" ${state.settings.darkMode ? "checked" : ""} />夜间模式</label><label class="check-row"><input data-checkbox-setting="reducedMotion" type="checkbox" ${state.settings.reducedMotion ? "checked" : ""} />减少动态效果</label></div></section></div></div></section>`;
  [...APP.querySelectorAll(".setting-group")].forEach((group, index) => { group.id = `setting-${index}`; });
  APP.querySelector("#setting-1 .setting-stack")?.insertAdjacentHTML("beforeend", `<label class="field-label">目标记忆率 <select data-number-setting="targetRetention" aria-label="目标记忆率"><option value="0.85" ${Number(state.settings.targetRetention) === .85 ? "selected" : ""}>85%</option><option value="0.9" ${Number(state.settings.targetRetention) === .9 ? "selected" : ""}>90%</option><option value="0.92" ${Number(state.settings.targetRetention) === .92 ? "selected" : ""}>92%</option><option value="0.95" ${Number(state.settings.targetRetention) === .95 ? "selected" : ""}>95%</option></select></label>`);
}

function render() { if (!state) return; ({ home: renderHome, words: renderWords, learn: renderLearn, review: renderReview, settings: renderSettings }[currentView] || renderHome)(); renderNav(); }

function parseWords(raw) {
  const words = [];
  String(raw || "").split(/\r?\n/).forEach((line) => {
    const clean = line.trim().toLowerCase();
    if (/^[a-z]+(?:[ '\-][a-z]+)*$/i.test(clean)) words.push(clean);
    else words.push(...(clean.match(/[a-z]+(?:['-][a-z]+)*/gi) || []).map((word) => word.toLowerCase()));
  });
  return [...new Set(words.filter((word) => word.length > 1))];
}
function isMissingDefinition(value) { return !String(value || "").trim() || /中文释义待补充|词性待补充/.test(String(value)); }
async function lookupOfflineDefinitions(words) {
  const terms = [...new Set((words || []).map((word) => String(word || "").trim().toLowerCase()).filter(Boolean))].slice(0, 1000);
  if (!terms.length) return new Map();
  try {
    const response = await fetch("/api/dictionary/lookup", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ words: terms }) });
    if (!response.ok) return new Map();
    const payload = await response.json();
    return new Map((payload.entries || []).map((entry) => [String(entry.word || "").toLowerCase(), entry]));
  } catch { return new Map(); }
}
function applyOfflineDefinition(word, entry) {
  if (!word || !entry) return false;
  let changed = false;
  const fields = ["definition", "phonetic", "partOfSpeech", "currentSense", "senses"];
  fields.forEach((field) => {
    const value = entry[field];
    if (value && (field === "definition" ? isMissingDefinition(word[field]) : !word[field] || (Array.isArray(word[field]) && !word[field].length))) { word[field] = value; changed = true; }
  });
  return changed;
}
async function hydrateOfflineDictionary() {
  const missing = activeWords().filter((word) => isMissingDefinition(word.definition) || !word.partOfSpeech).slice(0, 1000);
  if (!missing.length) return;
  const entries = await lookupOfflineDefinitions(missing.map((word) => word.text));
  let changed = false;
  missing.forEach((word) => { changed = applyOfflineDefinition(word, entries.get(word.text.toLowerCase())) || changed; });
  if (changed) { await persist(); render(); }
}
async function importWords(raw, source = "用户导入") {
  const parsed = parseWords(raw); if (!parsed.length) { showToast("没有找到可导入的英文单词。"); return; }
  const existing = new Set(activeWords().map((word) => word.text.toLowerCase())); const fresh = parsed.filter((word) => !existing.has(word)); if (!fresh.length) { showToast("这些词已经在当前单词本中了。"); return; }
  const offlineEntries = await lookupOfflineDefinitions(fresh); const batchId = id("batch"); const notebookId = state.activeNotebookId; const words = fresh.map((text) => { const base = wordData({ text }); const detail = WORD_DETAILS[text] || {}; const usage = WORD_USAGE_DETAILS[text] || {}; const offline = offlineEntries.get(text) || {}; return { id: id("word"), text, definition: base.zh || offline.definition || "", phonetic: base.phonetic || offline.phonetic || "", sentence: base.sentence || "", translation: base.translation || "", partOfSpeech: usage.currentPartOfSpeech || base.partOfSpeech || detail.partOfSpeech || offline.partOfSpeech || "", currentSense: base.currentSense || detail.currentSense || offline.currentSense || "", senses: base.senses || detail.senses || offline.senses || [], otherDefinitions: usage.otherDefinitions || [], learningSeen: false, learningPlanDate: null, stage: "learning", batchId, notebookId, dueAt: null, stability: null, difficulty: null, lastReviewAt: null, reviewCount: 0, lapses: 0, contexts: [], createdAt: new Date().toISOString() }; });
  state.words.push(...words); state.batches.push({ id: batchId, notebookId, wordIds: words.map((word) => word.id), source, status: "learning", createdAt: new Date().toISOString() }); selectedBatchId = batchId; await persist(); showToast(`已保存 ${words.length} 个词到「${activeNotebook()?.name}」。`); navigate("learn");
}
function loadDemo() { importWords(Object.keys(LEXICON).join("\n"), "基础版示例"); }
function updateWordDefinition(wordId, definition) { const word = state.words.find((item) => item.id === wordId); if (!word) return; word.definition = definition.trim(); persist(); }
function setActiveNotebook(notebookId) {
  const notebook = state.notebooks.find((item) => item.id === notebookId && !item.archivedAt); if (!notebook) return;
  state.activeNotebookId = notebook.id; selectedBatchId = state.batches.filter((batch) => batch.notebookId === notebook.id).at(-1)?.id || null; learnPage = 0; mistakePage = 0; savedPage = 0; question = null; persist(); render();
}
function createNotebook() {
  const field = document.querySelector("#new-notebook-name"); const name = field?.value.trim(); if (!name) { showToast("请先填写单词本名称。"); field?.focus(); return; }
  const notebook = { id: id("notebook"), name, createdAt: new Date().toISOString(), archivedAt: null }; state.notebooks.push(notebook); setActiveNotebook(notebook.id); showToast(`已新建「${name}」。`);
}
function archiveNotebook(notebookId) {
  const notebook = state.notebooks.find((item) => item.id === notebookId && !item.archivedAt); if (!notebook) return;
  if (!window.confirm(`归档「${notebook.name}」？词表和学习、复习记录都会保留，可随时恢复。`)) return;
  notebook.archivedAt = new Date().toISOString(); let next = state.notebooks.find((item) => !item.archivedAt);
  if (!next) { next = { id: id("notebook"), name: "新的单词本", createdAt: new Date().toISOString(), archivedAt: null }; state.notebooks.push(next); }
  setActiveNotebook(next.id); showToast(`已归档「${notebook.name}」，记录已保留。`);
}
function deleteNotebook(notebookId) {
  const notebook = state.notebooks.find((item) => item.id === notebookId); if (!notebook) return;
  if (!window.confirm(`彻底删除「${notebook.name}」的所有词和学习、复习记录？此操作不可恢复。`)) return;
  const wordIds = new Set(state.words.filter((word) => word.notebookId === notebook.id).map((word) => word.id));
  state.words = state.words.filter((word) => word.notebookId !== notebook.id); state.batches = state.batches.filter((batch) => batch.notebookId !== notebook.id); state.logs = state.logs.filter((log) => !wordIds.has(log.wordId)); state.notebooks = state.notebooks.filter((item) => item.id !== notebook.id);
  let next = state.notebooks.find((item) => !item.archivedAt); if (!next) { next = { id: id("notebook"), name: "新的单词本", createdAt: new Date().toISOString(), archivedAt: null }; state.notebooks.push(next); }
  setActiveNotebook(next.id); showToast("单词本及其学习、复习记录已彻底删除。");
}
async function deleteMasteredWord(wordId) {
  const word = state.words.find((item) => item.id === wordId && item.notebookId === state.activeNotebookId && item.stage === "mastered");
  if (!word) return;
  if (!window.confirm(`从当前词库删除「${word.text}」？它的学习与复习记录也会一并删除。`)) return;
  state.words = state.words.filter((item) => item.id !== wordId);
  state.logs = state.logs.filter((log) => log.wordId !== wordId);
  state.batches = state.batches.map((batch) => ({ ...batch, wordIds: batch.wordIds.filter((idValue) => idValue !== wordId) })).filter((batch) => batch.wordIds.length);
  selectedBatchId = state.batches.filter((batch) => batch.notebookId === state.activeNotebookId).at(-1)?.id || null;
  question = null; await persist(); showToast(`已从词库删除「${word.text}」。`); render();
}
function restoreNotebook(notebookId) { const notebook = state.notebooks.find((item) => item.id === notebookId && item.archivedAt); if (!notebook) return; notebook.archivedAt = null; setActiveNotebook(notebook.id); showToast(`已恢复「${notebook.name}」。`); }
function fileAsBase64(file) { return new Promise((resolve, reject) => { const reader = new FileReader(); reader.onerror = () => reject(reader.error || new Error("文件读取失败")); reader.onload = () => resolve(String(reader.result).split(",").at(-1)); reader.readAsDataURL(file); }); }
async function importFile(file) {
  const extension = file.name.slice(file.name.lastIndexOf(".")).toLowerCase(); if (!extension) { showToast("请选择 TXT、PDF、Word 或 XLSX 文件。"); return; }
  if (file.size > 10 * 1024 * 1024) { showToast("文件请控制在 10 MB 以内。导入只读取英文单词。 "); return; }
  try {
    showToast("正在本地读取文件…");
    const raw = extension === ".txt" ? await file.text() : (await (async () => { const response = await fetch("/api/extract", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name: file.name, file: await fileAsBase64(file) }) }); if (!response.ok) { const failure = await response.json().catch(() => ({})); throw new Error(failure.error || "文件解析失败"); } return (await response.json()).text; })());
    await importWords(raw, file.name);
  } catch (error) { showToast(`导入失败：${error.message}`); }
}

function retrievability(stability, elapsedDays) { const factor = Math.pow(0.9, -1 / FSRS6[20]) - 1; return Math.pow(1 + factor * elapsedDays / Math.max(stability, .1), -FSRS6[20]); }
function intervalFor(stability) { const retention = Math.max(.7, Math.min(.97, Number(state.settings.targetRetention))); const factor = Math.pow(0.9, -1 / FSRS6[20]) - 1; return Math.max(1, stability / factor * (Math.pow(retention, -1 / FSRS6[20]) - 1)); }
function memoryState(card, reference = now()) {
  const hasReview = Boolean(card.lastReviewAt && Number.isFinite(Number(card.stability)));
  const elapsed = hasReview ? daysBetween(card.lastReviewAt, reference) : null;
  return { hasReview, elapsed, retrievability: hasReview ? retrievability(Number(card.stability), elapsed) : null, stability: Number(card.stability) || null, difficulty: Number(card.difficulty) || null, reviewCount: Number(card.reviewCount) || 0, lapses: Number(card.lapses) || 0 };
}
function formatInterval(days) {
  if (!Number.isFinite(days)) return "首次巩固";
  const minutes = Math.max(1, Math.round(days * 1440));
  if (minutes < 60) return `${minutes} 分钟`;
  if (minutes < 1440) return `${Math.round(minutes / 60)} 小时`;
  return `${Math.max(1, Math.round((minutes / 1440) * 10) / 10)} 天`;
}
function formatReviewDate(iso) { return new Intl.DateTimeFormat("zh-CN", { timeZone: "Asia/Shanghai", month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit", hour12: false }).format(new Date(iso)); }
function reviewMemoryPanel(card, memory) {
  return `<section class="review-memory-panel"><div class="review-memory-heading"><span>记忆曲线</span><b>目标 ${Math.round(state.settings.targetRetention * 100)}%</b></div><dl><div><dt>当前保持率</dt><dd>${memory.hasReview ? `${Math.round(memory.retrievability * 100)}%` : "首次巩固"}</dd></div><div><dt>距上次复习</dt><dd>${memory.hasReview ? formatInterval(memory.elapsed) : "—"}</dd></div><div><dt>复习 / 遗忘</dt><dd>${memory.reviewCount} / ${memory.lapses}</dd></div></dl></section>`;
}
function initialDifficulty(grade) { return Math.max(1, Math.min(10, FSRS6[4] - Math.exp(FSRS6[5] * (grade - 1)) + 1)); }
function nextDifficulty(difficulty, grade) { const delta = -FSRS6[6] * (grade - 3); const damped = difficulty + delta * (10 - difficulty) / 9; const target = initialDifficulty(4); return Math.max(1, Math.min(10, FSRS6[7] * target + (1 - FSRS6[7]) * damped)); }
function schedule(card, grade) {
  const reviewedAt = now(); let stability; let difficulty;
  if (!card.stability) { stability = FSRS6[grade - 1]; difficulty = initialDifficulty(grade); }
  else { const elapsed = daysBetween(card.lastReviewAt, reviewedAt); const recall = retrievability(card.stability, elapsed); const priorDifficulty = Number.isFinite(Number(card.difficulty)) ? Number(card.difficulty) : initialDifficulty(3); difficulty = nextDifficulty(priorDifficulty, grade); if (grade === 1) stability = FSRS6[11] * Math.pow(difficulty, -FSRS6[12]) * (Math.pow(card.stability + 1, FSRS6[13]) - 1) * Math.exp(FSRS6[14] * (1 - recall)); else if (elapsed < 1) stability = card.stability * Math.exp(FSRS6[17] * (grade - 3 + FSRS6[18])) * Math.pow(card.stability, -FSRS6[19]); else { const bonus = grade === 2 ? FSRS6[15] : grade === 4 ? FSRS6[16] : 1; stability = card.stability * (Math.exp(FSRS6[8]) * (11 - difficulty) * Math.pow(card.stability, -FSRS6[9]) * (Math.exp(FSRS6[10] * (1 - recall)) - 1) * bonus + 1); } }
  const interval = grade === 1 ? 10 / 1440 : intervalFor(stability); card.stability = Math.max(.1, stability); card.difficulty = difficulty; card.lastReviewAt = reviewedAt.toISOString(); card.dueAt = hoursFromNow(interval * 24); card.reviewCount += 1; card.lapses += grade === 1 ? 1 : 0; card.stage = card.stability >= 20 && card.reviewCount >= 6 ? "mastered" : "review"; return { interval, stability: card.stability, difficulty, reviewedAt: card.lastReviewAt, nextDueAt: card.dueAt, targetRetention: Number(state.settings.targetRetention) };
}
async function completeLearning() { const batch = getBatch(); const cards = dailyStudyWordsForBatch(batch).filter((word) => word.stage === "learning"); if (!cards.length) { navigate("review"); return; } const unseen = cards.filter((word) => !word.learningSeen); if (unseen.length) { showToast(`还有 ${unseen.length} 个词未学习，请先完成学习。`); return; } if (isGateClosed()) { showToast("到期复习已达到门槛，请先完成复习。"); return; } cards.forEach((word) => { word.stage = "sameDay"; word.dueAt = new Date().toISOString(); }); batch.status = "reinforcing"; await persist(); navigate("review"); }
async function choose(option) {
  if (!question || question.answered || question.historical) return;
  const card = state.words.find((word) => word.id === question.wordId); if (!card) return;
  speak(option, "word"); question.selected = option; question.answered = true;
  const correct = option === card.text; const grade = correct ? (question.hintUsed ? 2 : 3) : 1;
  const responseTimeMs = Math.max(0, Date.now() - Number(question.startedAt || Date.now())); const before = memoryState(card);
  const result = schedule(card, grade);
  question.memoryResult = { before, interval: result.interval, nextDueAt: result.nextDueAt, targetRetention: result.targetRetention, stability: result.stability, difficulty: result.difficulty };
  reviewHistory.push(structuredClone(question)); reviewHistoryIndex = null; pausedQuestion = null;
  card.contexts.push({ id: id("context"), sceneId: question.sceneId, senseKey: question.contextSense || wordProfile(card).currentSense, zh: question.zh, sentence: question.sentence, usedAt: result.reviewedAt });
  state.logs.push({ id: id("review"), wordId: card.id, contextId: card.contexts.at(-1).id, senseKey: card.contexts.at(-1).senseKey, correct, hintUsed: question.hintUsed, grade, responseTimeMs, reviewedAt: result.reviewedAt, nextDueAt: card.dueAt, stability: result.stability, difficulty: result.difficulty, interval: result.interval, retentionBefore: before.retrievability });
  await persist(); render();
}
function reveal(useHint) { if (!question || question.answered) return; question.showingOptions = true; question.hintUsed = useHint; render(); }
function previousQuestion() {
  if (!reviewHistory.length) { showToast("还没有可回看的上一题。"); return; }
  if (!question?.historical) pausedQuestion = question;
  reviewHistoryIndex = reviewHistoryIndex === null ? reviewHistory.length - 1 : Math.max(0, reviewHistoryIndex - 1);
  question = { ...structuredClone(reviewHistory[reviewHistoryIndex]), historical: true }; render();
}
function nextQuestion() {
  if (question?.historical) {
    if (reviewHistoryIndex < reviewHistory.length - 1) { reviewHistoryIndex += 1; question = { ...structuredClone(reviewHistory[reviewHistoryIndex]), historical: true }; }
    else { question = pausedQuestion; pausedQuestion = null; reviewHistoryIndex = null; }
    render(); return;
  }
  question = null; render();
}

function enUsVoices() { return speechSynthesis.getVoices().filter((voice) => /^en[-_]US$/i.test(voice.lang)); }
function selectedVoice() { const voices = enUsVoices(); return voices.find((voice) => voice.voiceURI === state.settings.voiceURI) || voices[0] || null; }
function speak(text, type = "sentence") { if (!("speechSynthesis" in window)) { showToast("当前浏览器不支持朗读。"); return; } const voice = selectedVoice(); if (!voice) { showToast("未检测到 en-US 声音；请在设置中查看安装提示。"); return; } speechSynthesis.cancel(); const utterance = new SpeechSynthesisUtterance(text); utterance.voice = voice; utterance.lang = "en-US"; utterance.rate = type === "word" ? Number(state.settings.wordRate) : Number(state.settings.sentenceRate); speechSynthesis.speak(utterance); }
function markLearningSeen(word) {
  if (word.learningSeen) return; word.learningSeen = true; word.learnedAt = now().toISOString(); persist();
  const status = document.querySelector(`[data-learning-status="${word.id}"]`); if (status) { status.textContent = "已学习"; status.closest(".learning-word-nav")?.classList.add("is-seen"); }
  const summary = document.querySelector("[data-learning-summary]"); if (summary) { const learned = document.querySelectorAll(".learning-word-nav.is-seen").length; const total = document.querySelectorAll(".learning-word-nav").length; summary.innerHTML = `已学习 <strong>${learned}</strong> / ${total}`; }
  const dailyProgress = document.querySelector(".daily-progress-line"); if (dailyProgress) dailyProgress.innerHTML = `今日已学习 <strong>${dailyLearnedCount()} / ${dailyNewCount()}</strong> 个单词`;
}
function sentenceFor(word) { const base = wordData(word); return word.sentence || base.sentence || fallbackLearningLine(word, 0).sentence; }
function showTranslation(wordId, button) { const word = state.words.find((item) => item.id === wordId); const panel = document.querySelector(`[data-translation-panel="${wordId}"]`); if (!word || !panel) return; const shown = panel.classList.toggle("is-visible"); button.textContent = shown ? "收起句子意思" : "查看句子意思"; speak(sentenceFor(word), "sentence"); }
function popover(wordText, anchor) { document.querySelector(".word-popover")?.remove(); const word = activeWords().find((item) => item.text.toLowerCase() === wordText.toLowerCase()); if (!word) return; const profile = wordProfile(word); const box = anchor.getBoundingClientRect(); const element = document.createElement("aside"); element.className = "word-popover"; element.innerHTML = `<button class="speaker" data-speak-word="${word.id}" aria-label="朗读 ${escapeHtml(word.text)}">${SPEAKER_ICON}</button><h3>${escapeHtml(word.text)}</h3><p>${escapeHtml(word.phonetic || "音标待补充")}</p><p class="popover-current-sense"><span>${escapeHtml(profile.partOfSpeech)}</span>${escapeHtml(profile.currentSense)}</p>${profile.otherDefinitions.length ? `<p class="popover-label">其他常见释义</p><ul class="sense-list">${profile.otherDefinitions.map((item) => `<li><span>${escapeHtml(item.partOfSpeech)}</span>${escapeHtml(item.sense)}</li>`).join("")}</ul>` : ""}`; document.body.append(element); const padding = 16; const gap = 10; const width = element.offsetWidth; const height = element.offsetHeight; let left = Math.min(window.innerWidth - width - padding, Math.max(padding, box.left)); let top = box.bottom + gap; if (top + height > window.innerHeight - padding) top = box.top - height - gap; top = Math.max(padding, Math.min(top, window.innerHeight - height - padding)); element.style.left = `${left}px`; element.style.top = `${top}px`; markLearningSeen(word); speak(word.text, "word"); setTimeout(() => document.addEventListener("pointerdown", function dismiss(event) { if (!element.contains(event.target) && event.target !== anchor) { element.remove(); document.removeEventListener("pointerdown", dismiss); } }), 0); }
document.addEventListener("scroll", () => document.querySelector(".word-popover")?.remove(), true);

document.addEventListener("click", (event) => {
  const button = event.target.closest("button, [data-demo]"); if (!button) return;
  if (button.dataset.nav) navigate(button.dataset.nav);
  if (button.dataset.go) navigate(button.dataset.go);
  if (button.dataset.demo !== undefined) loadDemo();
  if (button.dataset.toggleTheme !== undefined) { state.settings.darkMode = !state.settings.darkMode; applyTheme(); persist(); renderNav(); }
  if (button.dataset.import !== undefined) importWords(document.querySelector("#word-input")?.value || "");
  if (button.dataset.createNotebook !== undefined) createNotebook();
  if (button.dataset.archiveNotebook) archiveNotebook(button.dataset.archiveNotebook);
  if (button.dataset.deleteNotebook) deleteNotebook(button.dataset.deleteNotebook);
  if (button.dataset.restoreNotebook) restoreNotebook(button.dataset.restoreNotebook);
  if (button.dataset.toggleWordbookPanel !== undefined) { wordbookPanelExpanded = !wordbookPanelExpanded; render(); }
  if (button.dataset.toggleSavedWords !== undefined) { savedWordsExpanded = !savedWordsExpanded; render(); }
  if (button.dataset.toggleMasteredWords !== undefined) { masteredWordsExpanded = !masteredWordsExpanded; render(); }
  if (button.dataset.mistakePage !== undefined) { mistakePage = Math.max(0, Number(button.dataset.mistakePage)); render(); }
  if (button.dataset.savedPage !== undefined) { savedPage = Math.max(0, Number(button.dataset.savedPage)); render(); }
  if (button.dataset.masteredPage !== undefined) { masteredPage = Math.max(0, Number(button.dataset.masteredPage)); render(); }
  if (button.dataset.deleteMasteredWord) deleteMasteredWord(button.dataset.deleteMasteredWord);
  if (button.dataset.historyMonth !== undefined) {
    const studyDays = studyHistoryDays(); const earliest = monthKey(studyDays.at(-1)?.dateKey || beijingDateKey()); const latest = monthKey(); const candidate = shiftMonth(historyCalendarMonth || latest, Number(button.dataset.historyMonth));
    if (candidate >= earliest && candidate <= latest) { historyCalendarMonth = candidate; render(); }
  }
  if (button.dataset.scrollSetting !== undefined) document.querySelector(`#setting-${button.dataset.scrollSetting}`)?.scrollIntoView({ behavior: state.settings.reducedMotion ? "auto" : "smooth", block: "start" });
  if (button.dataset.selectBatch) { selectedBatchId = button.dataset.selectBatch; learnPage = 0; revealedTranslations = new Set(); render(); }
  if (button.dataset.learnPage !== undefined) { learnPage = Number(button.dataset.learnPage); render(); window.scrollTo({ top: 0, behavior: state.settings.reducedMotion ? "auto" : "smooth" }); }
  if (button.dataset.jumpWord) { document.querySelector(`#learning-word-${button.dataset.jumpWord}`)?.scrollIntoView({ behavior: state.settings.reducedMotion ? "auto" : "smooth", block: "center" }); }
  if (button.dataset.completeLearning !== undefined) completeLearning();
  if (button.dataset.reveal !== undefined) reveal(button.dataset.reveal === "true");
  if (button.dataset.choice) choose(button.dataset.choice);
  if (button.dataset.nextQuestion !== undefined) nextQuestion();
  if (button.dataset.previousQuestion !== undefined) previousQuestion();
  if (button.dataset.speakWord) { const word = state.words.find((item) => item.id === button.dataset.speakWord); if (word) speak(word.text, "word"); }
  if (button.dataset.speakText) speak(button.dataset.speakText, "word");
  if (button.dataset.speakSentence) speak(button.dataset.speakSentence, "sentence");
  if (button.dataset.popoverWord) popover(button.dataset.popoverWord, button);
  if (button.dataset.showWord) { const word = state.words.find((item) => item.id === button.dataset.showWord); if (word) popover(word.text, button); }
  if (button.dataset.showTranslation) showTranslation(button.dataset.showTranslation, button);
  if (button.dataset.testVoice !== undefined) speak("A quiet morning begins with a new word.", "sentence");
});
document.addEventListener("change", (event) => {
  if (event.target.dataset.wordDefinition) updateWordDefinition(event.target.dataset.wordDefinition, event.target.value);
  if (event.target.dataset.fileInput && event.target.files?.[0]) { const file = event.target.files[0]; event.target.value = ""; importFile(file); }
  if (event.target.dataset.activeNotebook) setActiveNotebook(event.target.value);
  if (event.target.dataset.setting) { state.settings[event.target.dataset.setting] = event.target.value; persist(); }
  if (event.target.dataset.numberSetting) { state.settings[event.target.dataset.numberSetting] = Number(event.target.value); persist(); }
  if (event.target.dataset.checkboxSetting) { const key = event.target.dataset.checkboxSetting; state.settings[key] = event.target.checked; if (key === "reducedMotion") document.documentElement.dataset.reduceMotion = String(event.target.checked); if (key === "darkMode") { applyTheme(); renderNav(); } persist(); }
});
document.addEventListener("input", (event) => {
  if (event.target.dataset.librarySearch) {
    const value = event.target.value; librarySearch = value; mistakePage = 0; savedPage = 0; masteredPage = 0;
    if (currentView === "words") {
      renderWords();
      const field = document.querySelector('[data-library-search="all"]');
      field?.focus(); field?.setSelectionRange(value.length, value.length);
    }
  }
});
document.addEventListener("keydown", (event) => { const target = event.target; if (target.matches("input, textarea, select")) return; if (currentView !== "review" || !question) return; if (event.code === "Space") { event.preventDefault(); const word = state.words.find((item) => item.id === question.wordId); speak(question.sentence.replace("____", word?.text || ""), "sentence"); } if (question.showingOptions && !question.answered && /^[1-4]$/.test(event.key)) { const option = question.options[Number(event.key) - 1]; if (option) choose(option); } if (question.answered && event.key === "Enter") nextQuestion(); });
window.addEventListener("hashchange", () => { const view = window.location.hash.slice(1); if (["home", "words", "learn", "review", "settings"].includes(view) && currentView !== view) { currentView = view; question = null; render(); } });
if ("speechSynthesis" in window) speechSynthesis.addEventListener("voiceschanged", () => { if (currentView === "settings") render(); });

currentView = ["home", "words", "learn", "review", "settings"].includes(window.location.hash.slice(1)) ? window.location.hash.slice(1) : "home";
load();
