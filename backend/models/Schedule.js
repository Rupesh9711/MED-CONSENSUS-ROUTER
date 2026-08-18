const mongoose = require("mongoose");

const medicationEntrySchema = new mongoose.Schema(
  {
    name: {
      type: String,
      trim: true,
      default: ""
    },
    frequency: {
      type: Number,
      required: [true, "A dynamic frequency value is required."],
      min: [1, "Frequency must be at least one daily dose."]
    },
    mealCondition: {
      type: String,
      required: [true, "A mealCondition value is required."],
      enum: ["BEFORE_FOOD", "AFTER_FOOD", "ANY_TIME"]
    }
  },
  {
    _id: false
  }
);
   
const aiExtractedConflictSchema = new mongoose.Schema(
  {
    drugA: {
      type: String,
      required: true,
      trim: true
    },
    drugB: {
      type: String,
      required: true,
      trim: true
    },
    interactionSeverity: {
      type: String,
      required: true,
      trim: true
    },
    clinicalRationale: {
      type: String,
      required: true,
      trim: true
    }
  },
  {
    _id: false
  }
);

const scheduledDoseSchema = new mongoose.Schema(
  {
    subNodeId: {
      type: String,
      required: true,
      trim: true
    },
    baseDrugName: {
      type: String,
      required: true,
      trim: true
    },
    mealCondition: {
      type: String,
      required: true,
      enum: ["BEFORE_FOOD", "AFTER_FOOD", "ANY_TIME"]
    },
    doseOrdinal: {
      type: Number,
      required: true
    },
    scheduledTimeToken: {
      type: String,
      required: true,
      trim: true
    }
  },
  {
    _id: false
  }
);

const colorGroupedScheduleEntrySchema = new mongoose.Schema(
  {
    groupIndex: {
      type: Number,
      required: true
    },
    waveLabel: {
      type: String,
      required: true,
      trim: true
    },
    doses: {
      type: [scheduledDoseSchema],
      default: []
    }
  },
  {
    _id: false
  }
);

const scheduleSchema = new mongoose.Schema(
  {
    patientUserId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      unique: true
    },
    medicationsList: {
      type: [medicationEntrySchema],
      default: []
    },
    aiExtractedConflicts: {
      type: [aiExtractedConflictSchema],
      default: []
    },
    colorGroupedSchedule: {
      type: [colorGroupedScheduleEntrySchema],
      default: []
    },
    chromaticNumber: {
      type: Number,
      default: 0
    },
    circuitBreakerTriggered: {
      type: Boolean,
      default: false
    }
  },
  {
    timestamps: true
  }
);

module.exports = mongoose.model("Schedule", scheduleSchema);
