(function exposeContentDiagnostics(root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.ContentDiagnostics = api;
}(typeof globalThis !== "undefined" ? globalThis : this, function createContentDiagnostics() {
  const DIAGNOSTIC_THRESHOLDS = Object.freeze({
    minViews: 100,
    highExposure: 800,
    lowClickRate: 0.1,
    weakTwoSecondExitRate: 0.45,
    healthyViewRate: 0.12,
    lowInteractionRate: 0.04,
    highCollectRate: 0.03,
    minCollects: 3,
    highCommentRate: 0.01,
    lowCollectRateForDiscussion: 0.01,
    minComments: 2,
    highShareRate: 0.01,
    minShares: 2,
    healthyFollowRate: 0.004
  });
  const MIN_DIAGNOSTIC_VIEWS = DIAGNOSTIC_THRESHOLDS.minViews;

  function pctValue(value) {
    const number = Number(value || 0);
    if (!Number.isFinite(number)) return 0;
    return number > 1 ? number / 100 : number;
  }

  function contentRates(note) {
    const impressions = Number(note.impressions || 0);
    const views = Number(note.views || 0);
    const likes = Number(note.likes || 0);
    const comments = Number(note.comments || 0);
    const collects = Number(note.collects || 0);
    const shares = Number(note.shares || 0);
    const followersGained = Number(note.followersGained || 0);
    const interactions = likes + comments + collects + shares;

    return {
      impressions,
      views,
      likes,
      comments,
      collects,
      shares,
      followersGained,
      interactions,
      viewRate: impressions ? views / impressions : 0,
      interactionRate: views ? interactions / views : 0,
      likeRate: views ? likes / views : 0,
      commentRate: views ? comments / views : 0,
      collectRate: views ? collects / views : 0,
      shareRate: views ? shares / views : 0,
      followRate: views ? followersGained / views : 0,
      officialCoverClickRate: note.hasOfficialCoverClickRate ? pctValue(note.coverClickRatePct) : null,
      completionRate: pctValue(note.completionRatePct),
      twoSecondExitRate: pctValue(note.twoSecondExitRatePct),
      hasCompletionRate: Number(note.completionRatePct || 0) > 0,
      hasTwoSecondExitRate: Number(note.twoSecondExitRatePct || 0) > 0
    };
  }

  function contentDiagnostics(note) {
    const rates = contentRates(note);
    const items = [];

    if (rates.views < MIN_DIAGNOSTIC_VIEWS) {
      return [{
        type: "! 样本不足",
        detail: `当前观看数 ${rates.views}，低于 ${MIN_DIAGNOSTIC_VIEWS}，各行为率容易失真，暂不做强诊断。`
      }];
    }

    const clickRate = rates.officialCoverClickRate == null ? rates.viewRate : rates.officialCoverClickRate;
    if (rates.impressions >= DIAGNOSTIC_THRESHOLDS.highExposure && clickRate < DIAGNOSTIC_THRESHOLDS.lowClickRate) {
      items.push({
        type: "高曝光低点击",
        detail: "入口转化偏弱，优先测试封面、标题和首屏信息，不把问题归因到后续互动。"
      });
    }
    if (rates.hasTwoSecondExitRate && rates.twoSecondExitRate >= DIAGNOSTIC_THRESHOLDS.weakTwoSecondExitRate) {
      items.push({
        type: "前段留存偏弱",
        detail: "2 秒退出率偏高，检查开头是否快速兑现标题承诺、减少铺垫。"
      });
    }
    if (rates.viewRate >= DIAGNOSTIC_THRESHOLDS.healthyViewRate
      && rates.interactionRate < DIAGNOSTIC_THRESHOLDS.lowInteractionRate) {
      items.push({
        type: "高观看低互动",
        detail: "入口有效，但观看后的点赞、评论、收藏和分享整体偏弱，可加强观点、价值密度或行动触发。"
      });
    }
    if (rates.collects >= DIAGNOSTIC_THRESHOLDS.minCollects
      && rates.collectRate >= DIAGNOSTIC_THRESHOLDS.highCollectRate
      && rates.followRate < DIAGNOSTIC_THRESHOLDS.healthyFollowRate) {
      items.push({
        type: "高收藏低关注",
        detail: "内容具有保存价值，但关注理由相对弱；检查人设、系列感和主页承接。"
      });
    }
    if (rates.comments >= DIAGNOSTIC_THRESHOLDS.minComments
      && rates.commentRate >= DIAGNOSTIC_THRESHOLDS.highCommentRate
      && rates.collectRate < DIAGNOSTIC_THRESHOLDS.lowCollectRateForDiscussion) {
      items.push({
        type: "讨论强沉淀弱",
        detail: "评论意愿明显高于收藏意愿，说明话题性强；若目标是沉淀，可补充清单、步骤或结论。"
      });
    }
    if (rates.shares >= DIAGNOSTIC_THRESHOLDS.minShares
      && rates.shareRate >= DIAGNOSTIC_THRESHOLDS.highShareRate
      && rates.followRate < DIAGNOSTIC_THRESHOLDS.healthyFollowRate) {
      items.push({
        type: "传播强关注弱",
        detail: "内容值得转发，但账号价值没有同步转化；检查署名、人设和持续关注预期。"
      });
    }
    if (rates.followersGained > 0 && rates.followRate >= DIAGNOSTIC_THRESHOLDS.healthyFollowRate) {
      items.push({
        type: "关注转化突出",
        detail: "观看后的关注转化较好，值得复刻选题角度、表达方式和账号承接。"
      });
    }
    if (items.length === 0) {
      items.push({
        type: "行为分布均衡",
        detail: "暂未发现明显短板；继续按点击、留存和各观看后行为分别积累样本。"
      });
    }
    return items;
  }

  function behaviorBranches(note) {
    const rates = contentRates(note);
    return [
      { key: "likes", name: "点赞", value: rates.likes, rate: rates.likeRate },
      { key: "comments", name: "评论", value: rates.comments, rate: rates.commentRate },
      { key: "collects", name: "收藏", value: rates.collects, rate: rates.collectRate },
      { key: "shares", name: "分享", value: rates.shares, rate: rates.shareRate },
      { key: "followersGained", name: "关注", value: rates.followersGained, rate: rates.followRate }
    ];
  }

  return {
    DIAGNOSTIC_THRESHOLDS,
    MIN_DIAGNOSTIC_VIEWS,
    behaviorBranches,
    contentDiagnostics,
    contentRates
  };
}));
