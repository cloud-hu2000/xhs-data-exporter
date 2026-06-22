const fs = require("fs");
const path = require("path");

const MULTI_VALUE_FIELDS = [
  "contentTypes",
  "formats",
  "hooks",
  "coverStyles",
  "firstFiveSecondStructures",
  "targetActions",
  "audiences"
];

const DEFAULT_OPTIONS = Object.freeze({
  contentTypes: ["热点解读", "教程", "观点", "工具展示", "复盘", "AI 新闻", "案例拆解", "经验分享", "产品发布"],
  formats: ["图文", "口播", "屏幕演示", "真人演示", "混剪", "访谈", "直播切片", "动画讲解"],
  hooks: ["反差", "恐惧", "利益", "争议", "好奇", "痛点", "结果前置", "权威背书", "故事", "挑战"],
  coverStyles: ["大字冲突", "人物表情", "截图展示", "前后对比", "数据结果", "清单步骤", "极简标题", "产品界面", "热点人物"],
  firstFiveSecondStructures: ["结果前置", "问题开场", "冲突开场", "场景痛点", "新闻事实", "演示先行", "故事开场", "自我介绍"],
  targetActions: ["涨粉", "收藏", "评论", "分享", "引流", "品牌认知", "成交"],
  audiences: ["小白", "进阶用户", "从业者", "创作者", "开发者", "创业者", "管理者"]
});

function cleanText(value, maxLength = 120) {
  return String(value ?? "").replace(/\s+/g, " ").trim().slice(0, maxLength);
}

function cleanValues(values) {
  if (!Array.isArray(values)) return [];
  return [...new Set(values.map((value) => cleanText(value, 40)).filter(Boolean))].slice(0, 20);
}

function emptyStore() {
  return {
    schemaVersion: 1,
    updatedAt: "",
    customOptions: Object.fromEntries(MULTI_VALUE_FIELDS.map((field) => [field, []])),
    reviews: {}
  };
}

function normalizeReview(review = {}) {
  return {
    ...Object.fromEntries(MULTI_VALUE_FIELDS.map((field) => [field, cleanValues(review[field])])),
    videoDurationSeconds: Math.max(0, Math.min(86400, Number(review.videoDurationSeconds) || 0)),
    seriesName: cleanText(review.seriesName, 80),
    firstFiveSecondsNote: cleanText(review.firstFiveSecondsNote, 300),
    endingCtaNote: cleanText(review.endingCtaNote, 200),
    notes: cleanText(review.notes, 500),
    isTrendTracking: Boolean(review.isTrendTracking),
    hasPersonOnCamera: Boolean(review.hasPersonOnCamera),
    hasFollowCta: Boolean(review.hasFollowCta),
    updatedAt: cleanText(review.updatedAt, 40)
  };
}

function createNoteReviewStore(filePath) {
  function readStore() {
    if (!fs.existsSync(filePath)) return emptyStore();
    try {
      const parsed = JSON.parse(fs.readFileSync(filePath, "utf8"));
      const store = emptyStore();
      store.schemaVersion = Number(parsed.schemaVersion) || 1;
      store.updatedAt = cleanText(parsed.updatedAt, 40);
      for (const field of MULTI_VALUE_FIELDS) {
        store.customOptions[field] = cleanValues(parsed.customOptions?.[field]);
      }
      for (const [noteKey, review] of Object.entries(parsed.reviews || {})) {
        const key = cleanText(noteKey, 1000);
        if (key) store.reviews[key] = normalizeReview(review);
      }
      return store;
    } catch (error) {
      console.log(`Note review metadata skipped: ${error.message}`);
      return emptyStore();
    }
  }

  function writeStore(store) {
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, JSON.stringify(store, null, 2), "utf8");
  }

  function optionsFor(store) {
    return Object.fromEntries(MULTI_VALUE_FIELDS.map((field) => [
      field,
      [...new Set([...(DEFAULT_OPTIONS[field] || []), ...(store.customOptions[field] || [])])]
    ]));
  }

  function publicState() {
    const store = readStore();
    return {
      updatedAt: store.updatedAt,
      options: optionsFor(store),
      reviews: store.reviews
    };
  }

  function saveReview(noteKeyValue, reviewValue) {
    const noteKey = cleanText(noteKeyValue, 1000);
    if (!noteKey) throw new Error("noteKey is required");
    const store = readStore();
    const review = normalizeReview(reviewValue);
    const updatedAt = new Date().toISOString();
    review.updatedAt = updatedAt;
    store.reviews[noteKey] = review;
    store.updatedAt = updatedAt;

    for (const field of MULTI_VALUE_FIELDS) {
      const defaults = new Set(DEFAULT_OPTIONS[field] || []);
      const additions = review[field].filter((value) => !defaults.has(value));
      store.customOptions[field] = [...new Set([...(store.customOptions[field] || []), ...additions])];
    }

    writeStore(store);
    return {
      review,
      options: optionsFor(store),
      updatedAt
    };
  }

  function decorateDatabase(database) {
    const state = publicState();
    return {
      ...database,
      reviewMetadata: {
        updatedAt: state.updatedAt,
        options: state.options,
        reviewCount: Object.keys(state.reviews).length
      },
      notes: (database.notes || []).map((note) => ({
        ...note,
        review: state.reviews[note.noteKey] || null
      }))
    };
  }

  return {
    decorateDatabase,
    publicState,
    readStore,
    saveReview
  };
}

module.exports = {
  DEFAULT_OPTIONS,
  MULTI_VALUE_FIELDS,
  createNoteReviewStore,
  normalizeReview
};
