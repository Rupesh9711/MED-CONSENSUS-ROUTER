const express = require("express");
const jsonwebtoken = require("jsonwebtoken");
const { GoogleGenerativeAI, SchemaType } = require("@google/generative-ai");
const Schedule = require("../models/Schedule");

const scheduleRouter = express.Router();

const GEMINI_FLASH_MODEL_NAME = "gemini-3.5-flash";
const MAXIMUM_SAFE_CHROMATIC_NUMBER = 4;

const DYNAMIC_HOUR_SPACING_MATRIX = {
  0: {
    waveLabel: "Breakfast Wave",
    BEFORE_FOOD: "07:00 AM",
    AFTER_FOOD: "08:45 AM",
    ANY_TIME: "Flexible Window"
  },
  1: {
    waveLabel: "Lunch Wave",
    BEFORE_FOOD: "12:00 PM",
    AFTER_FOOD: "01:45 PM",
    ANY_TIME: "Flexible Window"
  },
  2: {
    waveLabel: "Dinner Wave",
    BEFORE_FOOD: "07:00 PM",
    AFTER_FOOD: "08:45 PM",
    ANY_TIME: "Flexible Window"
  },
  3: {
    waveLabel: "Before Sleep Wave",
    BEFORE_FOOD: "10:00 PM",
    ANY_TIME: "10:00 PM"
  }
};

const GEMINI_CONFLICT_RESPONSE_SCHEMA = {
  type: SchemaType.OBJECT,
  properties: {
    conflicts: {
      type: SchemaType.ARRAY,
      description: "Undirected pairs of base drug names that exhibit a clinically meaningful chemical cross-interaction.",
      items: {
        type: SchemaType.OBJECT,
        properties: {
          drugA: {
            type: SchemaType.STRING,
            description: "First base drug name exactly as supplied in the patient medication list."
          },
          drugB: {
            type: SchemaType.STRING,
            description: "Second base drug name exactly as supplied in the patient medication list."
          },
          interactionSeverity: {
            type: SchemaType.STRING,
            description: "Clinical severity classification such as minor, moderate, or major."
          },
          clinicalRationale: {
            type: SchemaType.STRING,
            description: "Concise pharmacological explanation of the chemical cross-interaction."
          }
        },
        required: ["drugA", "drugB", "interactionSeverity", "clinicalRationale"]
      }
    }
  },
  required: ["conflicts"]
};

function authenticateJsonWebToken(request, response, next) {
  const authorizationHeader = request.headers.authorization;
  if (!authorizationHeader || !authorizationHeader.startsWith("Bearer ")) {
    return response.status(401).json({
      message: "A Bearer JSON Web Token is required to access this personal health companion route."
    });
  }

  const sessionToken = authorizationHeader.slice("Bearer ".length).trim();

  try {
    const decodedPayload = jsonwebtoken.verify(sessionToken, process.env.JWT_SECRET);
    if (!decodedPayload.userId) {
      return response.status(401).json({
        message: "The session token is missing a patient user identifier."
      });
    }
    
    request.authenticatedPatientUserId = decodedPayload.userId;
    return next();
  } catch (error) {
    return response.status(401).json({
      message: "The session token is invalid or has expired.",
      diagnostic: error.message
    });
  }
}

function normalizeBaseDrugName(rawName) {
  return String(rawName || "")
    .trim()
    .replace(/\s+/g, "_");
}

function canonicalizeDrugNameForComparison(rawName) {
  return String(rawName || "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ");
}

function fragmentMedicationsIntoIndependentSubNodes(medicationsList) {
  const graphVertices = [];

  medicationsList.forEach(function fragmentSingleMedication(medicationEntry) {
    const baseDrugName = String(medicationEntry.name || "").trim();
    const mealCondition = medicationEntry.mealCondition;
    const dynamicFrequencyValue = Math.max(1, Number.parseInt(medicationEntry.frequency, 10) || 1);
    const sanitizedBaseName = normalizeBaseDrugName(baseDrugName);

    for (let doseOrdinal = 1; doseOrdinal <= dynamicFrequencyValue; doseOrdinal += 1) {
      const isFlexibleAnyTime = mealCondition === "ANY_TIME";
      graphVertices.push({
        subNodeIdentifier: sanitizedBaseName + "_Dose_" + doseOrdinal,
        baseDrugName: baseDrugName,
        canonicalBaseDrugName: canonicalizeDrugNameForComparison(baseDrugName),
        mealCondition: mealCondition,
        doseOrdinal: doseOrdinal,
        isFlexibleAnyTime: isFlexibleAnyTime,
        enemySubNodeIdentifiers: [],
        assignedColorIndex: null
      });
    }
  });

  return graphVertices;
}

function injectUndirectedConflictEdge(enemyLookupMap, firstSubNodeIdentifier, secondSubNodeIdentifier) {
  if (firstSubNodeIdentifier === secondSubNodeIdentifier) {
    return;
  }
  enemyLookupMap.get(firstSubNodeIdentifier).add(secondSubNodeIdentifier);
  enemyLookupMap.get(secondSubNodeIdentifier).add(firstSubNodeIdentifier);
}

function assembleConstraintEdges(graphVertices, aiExtractedConflicts) {
  const enemyLookupMap = new Map();
  graphVertices.forEach(function initializeEnemySet(vertex) {
    enemyLookupMap.set(vertex.subNodeIdentifier, new Set());
  });

  const chemicalInteractionCanonicalPairs = new Set();
  aiExtractedConflicts.forEach(function registerChemicalPair(conflictRecord) {
    const firstCanonicalName = canonicalizeDrugNameForComparison(conflictRecord.drugA);
    const secondCanonicalName = canonicalizeDrugNameForComparison(conflictRecord.drugB);
    if (!firstCanonicalName || !secondCanonicalName || firstCanonicalName === secondCanonicalName) {
      return;
    }
    const orderedPairKey = [firstCanonicalName, secondCanonicalName].sort().join("::");
    chemicalInteractionCanonicalPairs.add(orderedPairKey);
  });

  function baseNamesHaveChemicalCrossInteraction(firstCanonicalName, secondCanonicalName) {
    if (firstCanonicalName === secondCanonicalName) {
      return false;
    }
    const orderedPairKey = [firstCanonicalName, secondCanonicalName].sort().join("::");
    return chemicalInteractionCanonicalPairs.has(orderedPairKey);
  }

  for (let leftIndex = 0; leftIndex < graphVertices.length; leftIndex += 1) {
    for (let rightIndex = leftIndex + 1; rightIndex < graphVertices.length; rightIndex += 1) {
      const leftVertex = graphVertices[leftIndex];
      const rightVertex = graphVertices[rightIndex];

      const chemicalCrossInteractionFlagged = baseNamesHaveChemicalCrossInteraction(
        leftVertex.canonicalBaseDrugName,
        rightVertex.canonicalBaseDrugName
      );

      const separateIntradayDosesOfIdenticalDrug =
        leftVertex.canonicalBaseDrugName === rightVertex.canonicalBaseDrugName &&
        leftVertex.doseOrdinal !== rightVertex.doseOrdinal;

      const opposingStomachEnvironment =
        (leftVertex.mealCondition === "BEFORE_FOOD" && rightVertex.mealCondition === "AFTER_FOOD") ||
        (leftVertex.mealCondition === "AFTER_FOOD" && rightVertex.mealCondition === "BEFORE_FOOD");

      const sharedMacroMealWaveStomachClash =
        chemicalCrossInteractionFlagged && opposingStomachEnvironment && !leftVertex.isFlexibleAnyTime && !rightVertex.isFlexibleAnyTime;

      if (chemicalCrossInteractionFlagged || separateIntradayDosesOfIdenticalDrug || sharedMacroMealWaveStomachClash) {
        injectUndirectedConflictEdge(
          enemyLookupMap,
          leftVertex.subNodeIdentifier,
          rightVertex.subNodeIdentifier
        );
      }
    }
  }

  graphVertices.forEach(function materializeEnemyArray(vertex) {
    vertex.enemySubNodeIdentifiers = Array.from(enemyLookupMap.get(vertex.subNodeIdentifier));
  });

  return graphVertices;
}

function executeWelshPowellColoringWithConstantTimeSetTracking(graphVertices) {
  const verticesOrderedByDescendingDegree = graphVertices.slice().sort(function compareVertexPriority(leftVertex, rightVertex) {
    if (leftVertex.isFlexibleAnyTime !== rightVertex.isFlexibleAnyTime) {
      return leftVertex.isFlexibleAnyTime ? 1 : -1;
    }

    const leftDegree = leftVertex.isFlexibleAnyTime ? 0 : leftVertex.enemySubNodeIdentifiers.length;
    const rightDegree = rightVertex.isFlexibleAnyTime ? 0 : rightVertex.enemySubNodeIdentifiers.length;

    if (rightDegree !== leftDegree) {
      return rightDegree - leftDegree;
    }

    return leftVertex.subNodeIdentifier.localeCompare(rightVertex.subNodeIdentifier);
  });

  const uncoloredIdentifierSet = new Set(
    verticesOrderedByDescendingDegree.map(function readIdentifier(vertex) {
      return vertex.subNodeIdentifier;
    })
  );

  const colorClassWaves = [];

  while (uncoloredIdentifierSet.size > 0) {
    const activeColorGroupWave = new Set();
    const verticesAssignedThisWave = [];

    for (let candidateIndex = 0; candidateIndex < verticesOrderedByDescendingDegree.length; candidateIndex += 1) {
      const candidateVertex = verticesOrderedByDescendingDegree[candidateIndex];
      if (!uncoloredIdentifierSet.has(candidateVertex.subNodeIdentifier)) {
        continue;
      }

      const currentColorIndex = colorClassWaves.length;
      const isBeforeSleepEmptyStomachWave = currentColorIndex === 3;
      if (isBeforeSleepEmptyStomachWave && candidateVertex.mealCondition === "AFTER_FOOD") {
        continue;
      }

      let candidateConflictsWithActiveWave = false;
      const enemyArray = candidateVertex.enemySubNodeIdentifiers;
      for (let enemyIndex = 0; enemyIndex < enemyArray.length; enemyIndex += 1) {
        if (activeColorGroupWave.has(enemyArray[enemyIndex])) {
          candidateConflictsWithActiveWave = true;
          break;
        }
      }

      if (!candidateConflictsWithActiveWave) {
        activeColorGroupWave.add(candidateVertex.subNodeIdentifier);
        uncoloredIdentifierSet.delete(candidateVertex.subNodeIdentifier);
        candidateVertex.assignedColorIndex = currentColorIndex;
        verticesAssignedThisWave.push(candidateVertex);
      }
    }

    if (verticesAssignedThisWave.length === 0) {
      if (colorClassWaves.length === 3 && uncoloredIdentifierSet.size > 0) {
        colorClassWaves.push([]);
        continue;
      }
      break;
    }

    colorClassWaves.push(verticesAssignedThisWave);
  }

  return {
    chromaticNumber: colorClassWaves.length,
    colorClassWaves: colorClassWaves,
    verticesOrderedByDescendingDegree: verticesOrderedByDescendingDegree
  };
}

function mapColorClassesOntoHourSpacingMatrix(colorClassWaves) {
  return colorClassWaves
    .map(function mapSingleWave(verticesAssignedThisWave, groupIndex) {
      const matrixEntry = DYNAMIC_HOUR_SPACING_MATRIX[groupIndex];
      if (!matrixEntry || !Array.isArray(verticesAssignedThisWave) || verticesAssignedThisWave.length === 0) {
        return null;
      }

      const doses = verticesAssignedThisWave
        .filter(function keepEmptyStomachOnBeforeSleep(vertex) {
          if (groupIndex !== 3) {
            return true;
          }
          return vertex.mealCondition === "BEFORE_FOOD" || vertex.mealCondition === "ANY_TIME";
        })
        .map(function mapDoseOntoTimeToken(vertex) {
          const scheduledTimeToken = matrixEntry[vertex.mealCondition] || (groupIndex === 3 ? "10:00 PM" : "Flexible Window");
          return {
            subNodeId: vertex.subNodeIdentifier,
            baseDrugName: vertex.baseDrugName,
            mealCondition: vertex.mealCondition,
            doseOrdinal: vertex.doseOrdinal,
            scheduledTimeToken: scheduledTimeToken
          };
        });

      if (doses.length === 0) {
        return null;
      }

      doses.sort(function compareDoseTimeThenName(leftDose, rightDose) {
        if (leftDose.scheduledTimeToken !== rightDose.scheduledTimeToken) {
          return leftDose.scheduledTimeToken.localeCompare(rightDose.scheduledTimeToken);
        }
        return leftDose.subNodeId.localeCompare(rightDose.subNodeId);
      });

      return {
        groupIndex: groupIndex,
        waveLabel: matrixEntry.waveLabel,
        doses: doses
      };
    })
    .filter(function keepMappedWaves(mappedWave) {
      return mappedWave !== null;
    });
}

async function extractChemicalCrossInteractionsWithGemini(medicationsList) {
  const uniqueBaseDrugNames = Array.from(
    new Set(
      medicationsList
        .map(function readName(medicationEntry) {
          return String(medicationEntry.name || "").trim();
        })
        .filter(function keepNonEmpty(name) {
          return name.length > 0;
        })
    )
  );

  if (uniqueBaseDrugNames.length < 2) {
    return [];
  }

  if (!process.env.GEMINI_API_KEY) {
    throw new Error("GEMINI_API_KEY is not configured on the personal health companion backend.");
  }

  const generativeAiClient = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
  const geminiFlashModel = generativeAiClient.getGenerativeModel({
    model: GEMINI_FLASH_MODEL_NAME,
    generationConfig: {
      temperature: 0,
      responseMimeType: "application/json",
      responseSchema: GEMINI_CONFLICT_RESPONSE_SCHEMA
    }
  });

  const prompt =
    "You are a clinical pharmacology interaction classifier for a Direct-to-Consumer personal health companion. " +
    "Given the following unique base drug names, return only pairs that have a core chemical cross-interaction " +
    "supported by established pharmacological knowledge. Do not invent interactions. " +
    "Use the supplied names verbatim in drugA and drugB. " +
    "Base drug names: " +
    JSON.stringify(uniqueBaseDrugNames) +
    ".";

  const generationResult = await geminiFlashModel.generateContent(prompt);
  const responseText = generationResult.response.text();
  const parsedPayload = JSON.parse(responseText);
  const conflicts = Array.isArray(parsedPayload.conflicts) ? parsedPayload.conflicts : [];

  return conflicts
    .filter(function keepWellFormedConflict(conflictRecord) {
      return (
        conflictRecord &&
        typeof conflictRecord.drugA === "string" &&
        typeof conflictRecord.drugB === "string" &&
        conflictRecord.drugA.trim().length > 0 &&
        conflictRecord.drugB.trim().length > 0
      );
    })
    .map(function normalizeConflictRecord(conflictRecord) {
      return {
        drugA: conflictRecord.drugA.trim(),
        drugB: conflictRecord.drugB.trim(),
        interactionSeverity: String(conflictRecord.interactionSeverity || "unspecified").trim(),
        clinicalRationale: String(conflictRecord.clinicalRationale || "Chemical cross-interaction flagged by Gemini 3.5 Flash.").trim()
      };
    });
}

function validateMedicationsList(medicationsList) {
  if (!Array.isArray(medicationsList) || medicationsList.length === 0) {
    return "At least one medication entry is required before the consensus router can assemble a graph.";
  }

  const allowedMealConditions = new Set(["BEFORE_FOOD", "AFTER_FOOD", "ANY_TIME"]);

  for (let medicationIndex = 0; medicationIndex < medicationsList.length; medicationIndex += 1) {
    const medicationEntry = medicationsList[medicationIndex];
    const name = String(medicationEntry && medicationEntry.name ? medicationEntry.name : "").trim();
    const frequency = Number.parseInt(medicationEntry && medicationEntry.frequency, 10);
    const mealCondition = medicationEntry && medicationEntry.mealCondition;

    if (!name) {
      return "Every medication row must include a non-empty name.";
    }
    if (!Number.isFinite(frequency) || frequency < 1) {
      return "Every medication row must include a dynamic frequency of at least one daily dose.";
    }
    if (!allowedMealConditions.has(mealCondition)) {
      return "Every medication row must use mealCondition BEFORE_FOOD, AFTER_FOOD, or ANY_TIME.";
    }
  }

  return null;
}

scheduleRouter.use(authenticateJsonWebToken);

function normalizeWorkspaceMedicationsList(medicationsList) {
  if (!Array.isArray(medicationsList)) {
    return [];
  }

  const allowedMealConditions = new Set(["BEFORE_FOOD", "AFTER_FOOD", "ANY_TIME"]);

  return medicationsList.map(function normalizeMedicationEntry(medicationEntry) {
    const frequencyValue = Number.parseInt(medicationEntry && medicationEntry.frequency, 10);
    const mealCondition = allowedMealConditions.has(medicationEntry && medicationEntry.mealCondition)
      ? medicationEntry.mealCondition
      : "ANY_TIME";

    return {
      name: String(medicationEntry && medicationEntry.name ? medicationEntry.name : "").trim(),
      frequency: Number.isFinite(frequencyValue) && frequencyValue >= 1 ? frequencyValue : 1,
      mealCondition: mealCondition
    };
  });
}

scheduleRouter.put("/workspace", async function saveWorkspaceMedications(request, response) {
  try {
    const medicationsList = normalizeWorkspaceMedicationsList(
      request.body && request.body.medicationsList
    );
  
    const persistedSchedule = await Schedule.findOneAndUpdate(
      { patientUserId: request.authenticatedPatientUserId },
      {
        $set: {
          medicationsList: medicationsList
        },
        $setOnInsert: {
          patientUserId: request.authenticatedPatientUserId,
          aiExtractedConflicts: [],
          colorGroupedSchedule: [],
          chromaticNumber: 0,
          circuitBreakerTriggered: false
        }
      },
      {
        returnDocument: "after",
        upsert: true,
        setDefaultsOnInsert: true
      }
    );

    return response.status(200).json({
      medicationsList: persistedSchedule.medicationsList,
      aiExtractedConflicts: persistedSchedule.aiExtractedConflicts,
      colorGroupedSchedule: persistedSchedule.colorGroupedSchedule,
      chromaticNumber: persistedSchedule.chromaticNumber,
      circuitBreakerTriggered: persistedSchedule.circuitBreakerTriggered
    });
  } catch (error) {
    return response.status(500).json({
      message: "The medication workspace could not be saved.",
      diagnostic: error.message
    });
  }
});

scheduleRouter.get("/current", async function readCurrentSchedule(request, response) {
  try {
    const existingSchedule = await Schedule.findOne({
      patientUserId: request.authenticatedPatientUserId
    });

    if (!existingSchedule) {
      return response.status(200).json({
        medicationsList: [],
        aiExtractedConflicts: [],
        colorGroupedSchedule: [],
        chromaticNumber: 0,
        circuitBreakerTriggered: false
      });
    } 

    return response.status(200).json({
      medicationsList: existingSchedule.medicationsList,
      aiExtractedConflicts: existingSchedule.aiExtractedConflicts,
      colorGroupedSchedule: existingSchedule.colorGroupedSchedule,
      chromaticNumber: existingSchedule.chromaticNumber,
      circuitBreakerTriggered: existingSchedule.circuitBreakerTriggered
    });
  } catch (error) {
    return response.status(500).json({
      message: "The stored patient schedule could not be retrieved.",
      diagnostic: error.message
    });
  }
});

scheduleRouter.post("/generate", async function generateConsensusSchedule(request, response) {
  try {
    const medicationsList = (request.body && request.body.medicationsList) || [];
    const validationMessage = validateMedicationsList(medicationsList);
    if (validationMessage) {
      return response.status(400).json({ message: validationMessage });
    }

    const normalizedMedicationsList = medicationsList.map(function normalizeMedicationEntry(medicationEntry) {
      return {
        name: String(medicationEntry.name).trim(),
        frequency: Number.parseInt(medicationEntry.frequency, 10),
        mealCondition: medicationEntry.mealCondition
      };
    });

    let aiExtractedConflicts = [];
    try {
      aiExtractedConflicts = await extractChemicalCrossInteractionsWithGemini(normalizedMedicationsList);
    } catch (geminiError) {
      return response.status(502).json({
        message: "Gemini 3.5 Flash could not complete chemical cross-interaction schema mapping.",
        diagnostic: geminiError.message
      });
    }

    const fragmentedSubNodes = fragmentMedicationsIntoIndependentSubNodes(normalizedMedicationsList);
    const graphVertices = assembleConstraintEdges(fragmentedSubNodes, aiExtractedConflicts);
    const coloringResult = executeWelshPowellColoringWithConstantTimeSetTracking(graphVertices);
    const chromaticNumber = coloringResult.chromaticNumber;
    const circuitBreakerTriggered = chromaticNumber > MAXIMUM_SAFE_CHROMATIC_NUMBER;

    let colorGroupedSchedule = [];
    if (!circuitBreakerTriggered) {
      colorGroupedSchedule = mapColorClassesOntoHourSpacingMatrix(coloringResult.colorClassWaves);
    }

    const persistedSchedule = await Schedule.findOneAndUpdate(
      { patientUserId: request.authenticatedPatientUserId },
      {
        patientUserId: request.authenticatedPatientUserId,
        medicationsList: normalizedMedicationsList,
        aiExtractedConflicts: aiExtractedConflicts,
        colorGroupedSchedule: colorGroupedSchedule,
        chromaticNumber: chromaticNumber,
        circuitBreakerTriggered: circuitBreakerTriggered
      },
      {
        returnDocument: "after",
        upsert: true,
        setDefaultsOnInsert: true
      }
    );

    return response.status(200).json({
      medicationsList: persistedSchedule.medicationsList,
      aiExtractedConflicts: persistedSchedule.aiExtractedConflicts,
      colorGroupedSchedule: persistedSchedule.colorGroupedSchedule,
      chromaticNumber: persistedSchedule.chromaticNumber,
      circuitBreakerTriggered: persistedSchedule.circuitBreakerTriggered
    });
  } catch (error) {
    return response.status(500).json({
      message: "The medication consensus router could not complete layout calculation.",
      diagnostic: error.message
    });
  }
});

module.exports = scheduleRouter;
