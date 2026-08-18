import { useEffect, useRef, useState } from "react";
import dashboardStyles from "./Dashboard.module.css";
import TimelineView from "./TimelineView.jsx";

const BACKEND_ORIGIN = "http://localhost:5000";
const CIRCUIT_BREAKER_WARNING_MESSAGE =
  "🛑 CRITICAL SAFETY ALERT: PROCESS BLOCKED. Consult your doctor immediately to modify your prescriptions.";

function createEmptyMedicationRow() {
  return {
    name: "",
    frequency: 1,
    mealCondition: "ANY_TIME"
  };
}

export default function Dashboard({ sessionToken, patientEmail, onLogout }) {
  const [medicationsList, setMedicationsList] = useState([createEmptyMedicationRow()]);
  const [colorGroupedSchedule, setColorGroupedSchedule] = useState([]);
  const [aiExtractedConflicts, setAiExtractedConflicts] = useState([]);
  const [circuitBreakerTriggered, setCircuitBreakerTriggered] = useState(false);
  const [chromaticNumber, setChromaticNumber] = useState(0);
  const [isGenerating, setIsGenerating] = useState(false);
  const [statusMessage, setStatusMessage] = useState("");
  const [isCircuitBreakerModalVisible, setIsCircuitBreakerModalVisible] = useState(false);
  const hasCompletedHydrationRef = useRef(false);

  useEffect(
    function hydrateStoredSchedule() {
      let isCancelled = false;
      hasCompletedHydrationRef.current = false;

      async function readCurrentSchedule() {
        let didHydrateSuccessfully = false;
        try {
          const response = await fetch(BACKEND_ORIGIN + "/api/schedule/current", {
            method: "GET",
            headers: {
              Authorization: "Bearer " + sessionToken
            }
          });
          const payload = await response.json();
          if (!response.ok || isCancelled) {
            return;
          }
          if (Array.isArray(payload.medicationsList) && payload.medicationsList.length > 0) {
            setMedicationsList(payload.medicationsList);
            setStatusMessage(
              "Recovered " + payload.medicationsList.length + " saved medication row" +
                (payload.medicationsList.length === 1 ? "" : "s") +
                " for this account."
            );
          } else {
            setMedicationsList([createEmptyMedicationRow()]);
            setStatusMessage("No saved medications yet. Add rows and they will be stored with this account.");
          }
          setColorGroupedSchedule(payload.colorGroupedSchedule || []);
          setAiExtractedConflicts(payload.aiExtractedConflicts || []);
          setCircuitBreakerTriggered(Boolean(payload.circuitBreakerTriggered));
          setChromaticNumber(Number(payload.chromaticNumber) || 0);
          if (payload.circuitBreakerTriggered) {
            setIsCircuitBreakerModalVisible(true);
          }
          didHydrateSuccessfully = true;
        } catch (_networkError) {
          if (!isCancelled) {
            setStatusMessage("The stored schedule could not be loaded from the companion backend.");
          }
        } finally {
          if (didHydrateSuccessfully) {
            hasCompletedHydrationRef.current = true;
          }
        }
      }
   
      readCurrentSchedule();
   
      return function cancelHydration() {
        isCancelled = true;
      };
    },
    [sessionToken]
  );
   
  useEffect(
    function persistWorkspaceMedications() {
      if (!hasCompletedHydrationRef.current || !sessionToken) {
        return undefined;
      }
     
      const saveTimer = window.setTimeout(function saveWorkspace() {
        fetch(BACKEND_ORIGIN + "/api/schedule/workspace", {
          method: "PUT",
          headers: {
            "Content-Type": "application/json",
            Authorization: "Bearer " + sessionToken
          },
          body: JSON.stringify({
            medicationsList: medicationsList
          })
        }).catch(function ignoreTransientSaveError() {
          return undefined;
        });
      }, 450);

      return function cancelPendingSave() {
        window.clearTimeout(saveTimer);
      };
    },
    [medicationsList , sessionToken]
  );

  function addMedicationRow() {
    setMedicationsList(function appendRow(currentMedicationsList) {
      return currentMedicationsList.concat([createEmptyMedicationRow()]);
    });
  }

  function deleteMedicationRow(rowIndex) {
    setMedicationsList(function removeRowByIndex(currentMedicationsList) {
      return currentMedicationsList.filter(function keepRow(_medicationEntry, currentIndex) {
        return currentIndex !== rowIndex;
      });
    });
  }

  function updateMedicationField(rowIndex, fieldName, fieldValue) {
    setMedicationsList(function rewriteRow(currentMedicationsList) {
      return currentMedicationsList.map(function applyField(medicationEntry, currentIndex) {
        if (currentIndex !== rowIndex) {
          return medicationEntry;
        }
        return {
          name: medicationEntry.name,
          frequency: medicationEntry.frequency,
          mealCondition: medicationEntry.mealCondition,
          [fieldName]: fieldValue
        };
      });
    });
  }

  async function generateConsensusSchedule() {
    setIsGenerating(true);
    setStatusMessage("");

    try {
      const response = await fetch(BACKEND_ORIGIN + "/api/schedule/generate", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: "Bearer " + sessionToken
        },
        body: JSON.stringify({
          medicationsList: medicationsList
        })
      });

      const payload = await response.json();
      if (!response.ok) {
        const diagnosticSuffix = payload.diagnostic ? " " + payload.diagnostic : "";
        setStatusMessage((payload.message || "The consensus router could not generate a schedule.") + diagnosticSuffix);
        setIsGenerating(false);
        return;
      }

      setAiExtractedConflicts(payload.aiExtractedConflicts || []);
      setChromaticNumber(Number(payload.chromaticNumber) || 0);
      setCircuitBreakerTriggered(Boolean(payload.circuitBreakerTriggered));

      if (payload.circuitBreakerTriggered) {
        setColorGroupedSchedule([]);
        setIsCircuitBreakerModalVisible(true);
        setStatusMessage("Layout calculation halted because the chromatic number exceeded four.");
      } else {
        setColorGroupedSchedule(payload.colorGroupedSchedule || []);
        setIsCircuitBreakerModalVisible(false);
        setStatusMessage(
          "Welsh-Powell assigned " +
            payload.chromaticNumber +
            " safe color group wave" +
            (payload.chromaticNumber === 1 ? "" : "s") +
            " across the 15-hour waking day."
        );
      }
    } catch (_networkError) {
      setStatusMessage("The companion backend is unreachable. Confirm the Express runner is listening on port 5000.");
    }

    setIsGenerating(false);
  }
 
  return (
    <div className={dashboardStyles.applicationShell}>
      <header className={dashboardStyles.topBar}>
        <div className={dashboardStyles.brandBlock}>
          <p className={dashboardStyles.eyebrow}>Direct-to-Consumer Companion</p>
          <h1 className={dashboardStyles.brandTitle}>Patient-Centric Medication Consensus Router</h1>
          <p className={dashboardStyles.brandSubtitle}>
            Cloud-backed scheduling that fragments doses, injects chemical and meal-window conflict edges,
            then colors the graph with Welsh-Powell before mapping groups onto a 15-hour waking day.
          </p>
        </div>
        <div className={dashboardStyles.sessionCluster}>
          <p className={dashboardStyles.sessionEmail}>{patientEmail}</p>
          <button className={dashboardStyles.ghostButton} type="button" onClick={onLogout}>
            End session
          </button>
        </div>
      </header>
   
      <main className={dashboardStyles.workspaceGrid}>
        <section className={dashboardStyles.panel}>
          <div className={dashboardStyles.panelHeader}>
            <div>
              <h2 className={dashboardStyles.panelTitle}>Prescription workspace</h2>
              <p className={dashboardStyles.panelCopy}>
                Track name, dynamic frequency, and mealCondition. Use + to append a row and − to delete a
                row by index filtering before the engine fragments each medication into independent sub-nodes.
              </p>
            </div>
          </div>
    
          <div className={dashboardStyles.rowStack}>
            {medicationsList.map(function renderMedicationRow(medicationEntry, rowIndex) {
              return (
                <div className={dashboardStyles.medicationRow} key={"medication-row-" + rowIndex}>
                  <label className={dashboardStyles.fieldGroup}>
                    <span className={dashboardStyles.fieldLabel}>Medication name</span>
                    <input
                      className={dashboardStyles.textInput}
                      type="text"
                      value={medicationEntry.name}
                      onChange={function onNameChange(event) {
                        updateMedicationField(rowIndex, "name", event.target.value);
                      }}
                      placeholder="Aspirin"
                    />
                  </label>
                  <label className={dashboardStyles.fieldGroup}>
                    <span className={dashboardStyles.fieldLabel}>Frequency</span>
                    <input
                      className={dashboardStyles.textInput}
                      type="number"
                      min="1"
                      step="1"
                      value={medicationEntry.frequency}
                      onChange={function onFrequencyChange(event) {
                        updateMedicationField(rowIndex, "frequency", Number(event.target.value));
                      }}
                    />
                  </label>
                  <label className={dashboardStyles.fieldGroup}>
                    <span className={dashboardStyles.fieldLabel}>Meal condition</span>
                    <select
                      className={dashboardStyles.selectInput}
                      value={medicationEntry.mealCondition}
                      onChange={function onMealConditionChange(event) {
                        updateMedicationField(rowIndex, "mealCondition", event.target.value);
                      }}
                    >
                      <option value="BEFORE_FOOD">BEFORE_FOOD</option>
                      <option value="AFTER_FOOD">AFTER_FOOD</option>
                      <option value="ANY_TIME">ANY_TIME</option>
                    </select>
                  </label>
                  <button
                    className={dashboardStyles.deleteButton}
                    type="button"
                    onClick={function onDeleteRow() {
                      deleteMedicationRow(rowIndex);
                    }}
                    aria-label="Delete medication row"
                  >
                    −
                  </button>
                </div>
              );
            })}
          </div>
    
          <div className={dashboardStyles.actionRow}>
            <button className={dashboardStyles.addButton} type="button" onClick={addMedicationRow}>
              + Add medication
            </button>
            <button
              className={dashboardStyles.generateButton}
              type="button"
              onClick={generateConsensusSchedule}
              disabled={isGenerating || medicationsList.length === 0}
            >
              {isGenerating ? "Routing consensus..." : "Generate consensus schedule"}
            </button>
          </div>
     
          {statusMessage ? <p className={dashboardStyles.statusBanner}>{statusMessage}</p> : null}

          {aiExtractedConflicts.length > 0 ? (
            <ul className={dashboardStyles.conflictList}>
              {aiExtractedConflicts.map(function renderConflict(conflictRecord, conflictIndex) {
                return (
                  <li className={dashboardStyles.conflictItem} key={"conflict-" + conflictIndex}>
                    <p className={dashboardStyles.conflictTitle}>
                      {conflictRecord.drugA} × {conflictRecord.drugB} · {conflictRecord.interactionSeverity}
                    </p>
                    <p className={dashboardStyles.conflictBody}>{conflictRecord.clinicalRationale}</p>
                  </li>
                );
              })}
            </ul>
          ) : null}
        </section>
   
        <section className={dashboardStyles.panel}>
          <div className={dashboardStyles.panelHeader}>
            <div>
              <h2 className={dashboardStyles.panelTitle}>Unified daily timeline</h2>
              <p className={dashboardStyles.panelCopy}>
                Color-coded cards stack matching doses that share a temporal window. Chromatic number currently{" "}
                {chromaticNumber}. Circuit breaker {circuitBreakerTriggered ? "is engaged" : "is idle"}.
              </p>
            </div>
          </div>
          {circuitBreakerTriggered ? (
            <p className={dashboardStyles.statusBanner}>
              Calendar rendering is blocked until prescriptions are modified and the graph becomes 4-colorable.
            </p>
          ) : (
            <TimelineView colorGroupedSchedule={colorGroupedSchedule} />
          )}
        </section>
      </main>
   
      {isCircuitBreakerModalVisible ? (
        <div className={dashboardStyles.modalOverlay} role="alertdialog" aria-modal="true">
          <div className={dashboardStyles.modalCard}>
            <p className={dashboardStyles.modalEyebrow}>Circuit breaker</p>
            <p className={dashboardStyles.modalMessage}>{CIRCUIT_BREAKER_WARNING_MESSAGE}</p>
            <button
              className={dashboardStyles.modalButton}
              type="button"
              onClick={function dismissCircuitBreakerModal() {
                setIsCircuitBreakerModalVisible(false);
              }}
            >
              Return to workspace
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
