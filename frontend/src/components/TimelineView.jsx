import timelineStyles from "./TimelineView.module.css";

const WAVE_STYLE_BY_LABEL = {
  "Breakfast Wave": timelineStyles.breakfast,
  "Lunch Wave": timelineStyles.lunch,
  "Dinner Wave": timelineStyles.dinner,
  "Before Sleep Wave": timelineStyles.beforeSleep
};

function resolveCardTone(waveLabel, scheduledTimeToken) {
  if (scheduledTimeToken === "Flexible Window") {
    return timelineStyles.flexible;
  }
  return WAVE_STYLE_BY_LABEL[waveLabel] || timelineStyles.flexible;
}

function mealConditionDisplayLabel(mealCondition, waveLabel) {
  if (waveLabel === "Before Sleep Wave") {
    return "Empty stomach · before sleep";
  }
  if (mealCondition === "BEFORE_FOOD") {
    return "Before food";
  }
  if (mealCondition === "AFTER_FOOD") {
    return "After food";
  }
  return "Flexible meal timing";
}

function resolveChronologicalRank(scheduledTimeToken, groupIndex) {
  const chronologicalRank = {
    "07:00 AM": 0,
    "08:45 AM": 1,
    "12:00 PM": 3,
    "01:45 PM": 4,
    "07:00 PM": 5,
    "08:45 PM": 6,
    "10:00 PM": 7
  };

  if (scheduledTimeToken === "Flexible Window") {
    return groupIndex * 3 + 1.5;
  }

  const mappedRank = chronologicalRank[scheduledTimeToken];
  return Number.isFinite(mappedRank) ? mappedRank : 50 + groupIndex;
}

function buildUnifiedTimeWindows(colorGroupedSchedule) {
  const windowMap = new Map();

  colorGroupedSchedule.forEach(function collectGroup(colorGroup) {
    const doses = Array.isArray(colorGroup.doses) ? colorGroup.doses : [];
    doses.forEach(function collectDose(doseItem) {
      const scheduledTimeToken = doseItem.scheduledTimeToken || "Flexible Window";
      const windowKey = colorGroup.waveLabel + "::" + scheduledTimeToken;
      if (!windowMap.has(windowKey)) {
        windowMap.set(windowKey, {
          windowKey: windowKey,
          scheduledTimeToken: scheduledTimeToken,
          waveLabel: colorGroup.waveLabel,
          groupIndex: colorGroup.groupIndex,
          doses: []
        });
      }
      windowMap.get(windowKey).doses.push({
        subNodeId: doseItem.subNodeId,
        baseDrugName: doseItem.baseDrugName,
        mealCondition: doseItem.mealCondition,
        doseOrdinal: doseItem.doseOrdinal,
        scheduledTimeToken: scheduledTimeToken,
        waveLabel: colorGroup.waveLabel
      });
    });
  });

  return Array.from(windowMap.values()).sort(function compareWindows(leftWindow, rightWindow) {
    const leftValue = resolveChronologicalRank(leftWindow.scheduledTimeToken, leftWindow.groupIndex);
    const rightValue = resolveChronologicalRank(rightWindow.scheduledTimeToken, rightWindow.groupIndex);
    if (leftValue !== rightValue) {
      return leftValue - rightValue;
    }
    return leftWindow.scheduledTimeToken.localeCompare(rightWindow.scheduledTimeToken);
  });
}

export default function TimelineView({ colorGroupedSchedule }) {
  const safeColorGroupedSchedule = Array.isArray(colorGroupedSchedule) ? colorGroupedSchedule : [];
  const unifiedTimeWindows = buildUnifiedTimeWindows(safeColorGroupedSchedule);

  if (unifiedTimeWindows.length === 0) {
    return (
      <p className={timelineStyles.emptyState}>
        Generate a consensus schedule to render the unified daily timeline. Matching doses that share a
        time window will stack together on the same track.
      </p>
    );
  }

  return (
    <div className={timelineStyles.timelineShell}>
      <div className={timelineStyles.trackLine} />
      {unifiedTimeWindows.map(function renderTimeWindow(timeWindow) {
        return (
          <section className={timelineStyles.windowBlock} key={timeWindow.windowKey}>
            <span className={timelineStyles.windowDot} />
            <div className={timelineStyles.windowHeader}>
              <h3 className={timelineStyles.windowTime}>{timeWindow.scheduledTimeToken}</h3>
              <p className={timelineStyles.windowMeta}>{timeWindow.waveLabel}</p>
            </div>
            <div className={timelineStyles.cardStack}>
              {timeWindow.doses.map(function renderDoseCard(doseItem) {
                const cardTone = resolveCardTone(doseItem.waveLabel, doseItem.scheduledTimeToken);
                return (
                  <article
                    className={`${timelineStyles.doseCard} ${cardTone}`}
                    key={doseItem.subNodeId}
                  >
                    <h4 className={timelineStyles.doseName}>{doseItem.baseDrugName}</h4>
                    <p className={timelineStyles.doseMeta}>
                      Dose {doseItem.doseOrdinal} · {mealConditionDisplayLabel(doseItem.mealCondition, doseItem.waveLabel)}
                    </p>
                    <span className={timelineStyles.subNodeChip}>{doseItem.subNodeId}</span>
                  </article>
                );
              })}
            </div>
          </section>
        );
      })}
    </div>
  );
}
