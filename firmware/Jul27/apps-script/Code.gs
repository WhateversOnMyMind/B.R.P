/* Per-board 10-second records:
 * {"arm":"L","count":12,"distance":345.67,"alerted":true}
 * Timestamp | Arm | Count | Distance(cm) | Alerted Arm
 * Alerted Arm: L/R if output was commanded during this window, None if not,
 * Unknown for legacy firmware without the alerted field. Not a physical sensor.
 * Replace the existing script and update its existing web-app deployment.
 */
function jsonResponse(value) {
  return ContentService.createTextOutput(JSON.stringify(value))
    .setMimeType(ContentService.MimeType.JSON);
}

function doPost(e) {
  var lock = LockService.getScriptLock();
  var locked = false;
  try {
    lock.waitLock(30000);
    locked = true;
    var data = JSON.parse(e.postData.contents);
    var ss = SpreadsheetApp.getActiveSpreadsheet();
    if (data.event === "motor_toggle") {
      var eventsSheet = ss.getSheetByName("Events");
      if (!eventsSheet) {
        eventsSheet = ss.insertSheet("Events");
        eventsSheet.appendRow(["Received At", "Event", "State", "Board Timestamp"]);
      }
      var boardTime = data.ts ? new Date(Number(data.ts) * 1000) : null;
      eventsSheet.appendRow([new Date(), data.event, String(data.state), boardTime]);
      return jsonResponse({ status: "ok", event: data.event });
    }
    var arm = String(data.arm);
    if (arm !== "L" && arm !== "R") throw new Error("arm must be L or R");
    var count = Number(data.count);
    var distance = Number(data.distance);
    if (!isFinite(count) || !isFinite(distance)) throw new Error("Invalid count or distance");
    var alertedArm = "Unknown";
    if (Object.prototype.hasOwnProperty.call(data, "alerted")) {
      if (typeof data.alerted !== "boolean") throw new Error("alerted must be a boolean");
      alertedArm = data.alerted ? arm : "None";
    }
    var sheet = ss.getSheetByName("Data") || ss.getSheets()[0];
    if (sheet.getLastRow() === 0) {
      sheet.appendRow(["Timestamp", "Arm", "Count", "Distance(cm)", "Alerted Arm"]);
    } else {
      var header = sheet.getRange(1, 5);
      var existing = header.getValue();
      if (existing === "") header.setValue("Alerted Arm");
      else if (existing !== "Alerted Arm") throw new Error("Column E is already in use; reserve it for Alerted Arm");
    }
    sheet.appendRow([new Date(), arm, count, distance, alertedArm]);
    return jsonResponse({ status: "ok", arm: arm });
  } catch (err) {
    return jsonResponse({ status: "error", message: String(err) });
  } finally {
    if (locked) lock.releaseLock();
  }
}

function doGet(e) {
  var wantArm = e && e.parameter && e.parameter.arm ? String(e.parameter.arm) : null;
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName("Data") || ss.getSheets()[0];
  var values = sheet.getDataRange().getValues();
  var hasAlerts = values.length > 0 && values[0][4] === "Alerted Arm";
  for (var i = values.length - 1; i >= 1; i--) {
    if (!wantArm || String(values[i][1]) === wantArm) {
      var alert = hasAlerts ? values[i][4] : null;
      return jsonResponse({
        arm: values[i][1], count: values[i][2], distance: values[i][3],
        timestamp: values[i][0],
        alertedArm: alert === "L" || alert === "R" || alert === "None" ? alert : "Unknown"
      });
    }
  }
  return jsonResponse({ status: "empty" });
}
