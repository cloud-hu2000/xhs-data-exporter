function normalizeFieldToken(value) {
  return String(value ?? "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, "")
    .replace(/（/g, "(")
    .replace(/）/g, ")")
    .replace(/[：:]/g, "")
    .replace(/\((?:%|百分比|s|秒)\)$/i, "");
}

const FIELD_DEFINITIONS = [
  { id: "impressions", canonical: "曝光数", kind: "basic", aliases: ["曝光量"] },
  { id: "views", canonical: "观看数", kind: "basic", aliases: ["播放数", "播放量"] },
  { id: "coverClickRate", canonical: "封面点击率", kind: "basic", aliases: ["封面点击率(%)"] },
  {
    id: "avgWatchSeconds",
    canonical: "平均观看时长",
    kind: "basic",
    aliases: ["平均观看时长(s)", "平均观看时长（s）", "人均观看时长", "人均观看时长(s)"]
  },
  { id: "completionRate", canonical: "完播率", kind: "basic", aliases: ["完播率(%)"] },
  {
    id: "twoSecondExitRate",
    canonical: "2秒退出率",
    kind: "basic",
    aliases: ["2s退出率", "2s退出率(%)", "2秒退出率(%)"]
  },
  { id: "followersGained", canonical: "涨粉数", kind: "basic", aliases: ["新增粉丝数", "新增关注数"] },
  { id: "likes", canonical: "点赞数", kind: "interaction", aliases: ["点赞", "获赞数"] },
  { id: "comments", canonical: "评论数", kind: "interaction", aliases: ["评论"] },
  { id: "collects", canonical: "收藏数", kind: "interaction", aliases: ["收藏"] },
  {
    id: "shares",
    canonical: "分享数",
    kind: "interaction",
    aliases: ["笔记分享数", "转发数", "转发量", "分享量"]
  },
  { id: "danmaku", canonical: "弹幕数", kind: "interaction", aliases: ["弹幕"] },
  { id: "impressionsFollowerRatio", canonical: "曝光数粉丝占比", kind: "basic", aliases: ["曝光数粉丝占比(%)"] },
  { id: "viewsFollowerRatio", canonical: "观看数粉丝占比", kind: "basic", aliases: ["观看数粉丝占比(%)"] },
  {
    id: "coverClickRateFollowerRatio",
    canonical: "封面点击率粉丝占比",
    kind: "basic",
    aliases: ["封面点击率粉丝占比(%)"]
  },
  {
    id: "avgWatchFollowerRatio",
    canonical: "平均观看时长粉丝占比",
    kind: "basic",
    aliases: ["平均观看时长粉丝占比(%)"]
  },
  { id: "completionFollowerRatio", canonical: "完播率粉丝占比", kind: "basic", aliases: ["完播率粉丝占比(%)"] },
  {
    id: "twoSecondExitFollowerRatio",
    canonical: "2秒退出率粉丝占比",
    kind: "basic",
    aliases: ["2s退出率粉丝占比(%)", "2秒退出率粉丝占比(%)"]
  },
  { id: "likesFollowerRatio", canonical: "点赞数粉丝占比", kind: "interaction", aliases: ["点赞数粉丝占比(%)"] },
  { id: "commentsFollowerRatio", canonical: "评论数粉丝占比", kind: "interaction", aliases: ["评论数粉丝占比(%)"] },
  { id: "collectsFollowerRatio", canonical: "收藏数粉丝占比", kind: "interaction", aliases: ["收藏数粉丝占比(%)"] },
  {
    id: "sharesFollowerRatio",
    canonical: "分享数粉丝占比",
    kind: "interaction",
    aliases: ["分享数粉丝占比(%)", "笔记分享数粉丝占比(%)", "转发数粉丝占比(%)"]
  },
  { id: "danmakuFollowerRatio", canonical: "弹幕数粉丝占比", kind: "interaction", aliases: ["弹幕数粉丝占比(%)"] }
];

const definitionByToken = new Map();
for (const definition of FIELD_DEFINITIONS) {
  for (const label of [definition.canonical, ...definition.aliases]) {
    definitionByToken.set(normalizeFieldToken(label), definition);
  }
}

function resolveMetricField(value) {
  const source = String(value ?? "").trim();
  const definition = definitionByToken.get(normalizeFieldToken(source));
  if (!definition) {
    return {
      source,
      recognized: false,
      canonical: "",
      id: "",
      kind: "",
      matchedBy: ""
    };
  }

  return {
    source,
    recognized: true,
    canonical: definition.canonical,
    id: definition.id,
    kind: definition.kind,
    matchedBy: normalizeFieldToken(source) === normalizeFieldToken(definition.canonical) ? "canonical" : "alias"
  };
}

function definitionsForClient() {
  return FIELD_DEFINITIONS.map(({ id, canonical, kind, aliases }) => ({
    id,
    canonical,
    kind,
    aliases: [...aliases]
  }));
}

module.exports = {
  FIELD_DEFINITIONS,
  definitionsForClient,
  normalizeFieldToken,
  resolveMetricField
};
