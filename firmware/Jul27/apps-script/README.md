# Alerted-arm logging

Replace your existing Apps Script code with `Code.gs`. In Apps Script select **Deploy > Manage deployments**, select your existing web app, **Edit**, **Version > New version**, then **Deploy**. Updating that deployment preserves its `/exec` URL, so the firmware endpoint does not need changing. See [Google's version instructions](https://developers.google.com/apps-script/guides/versions) and [deployment documentation](https://developers.google.com/apps-script/concepts/deployments).

Flash the updated firmware on each board, selecting its existing `ARM_IS_LEFT` setting appropriately. The script can be deployed first: older firmware continues to log its original measurements with `Unknown` in the new column.

The receiver retains columns A–D and adds **Alerted Arm** in E on the next measurement post. Keep E available; an existing different E header causes an explicit error instead of overwriting it. Existing historical rows are left untouched. Toggle events retain their existing separate Events sheet.

| Alerted Arm | Meaning for this row's measurement window |
| --- | --- |
| L / R | That board commanded its alert output during the window |
| None | Updated firmware commanded no alert output during the window |
| Unknown | Older firmware did not supply alert information |

Each board still posts its own row. Both arms can therefore have alerts in their respective rows. This reports commanded vibration/piezo output, not sensor confirmation that the actuator physically worked. Brief pulses are retained after they end; output spanning a boundary counts in both affected windows. It does not report pulse count, intensity, or duration. The timestamp remains the server's receipt time.

`doGet` preserves `arm`, `count`, `distance`, and `timestamp`, and adds `alertedArm`; old rows return `Unknown`.

Run `node --test Jul27/tests/apps_script_test.mjs` from the workspace to exercise the actual receiver against local Apps Script mocks. No test writes to your live spreadsheet. After deployment and flashing, verify L and R alerts, a quiet window, and a motor toggle in the live sheet.
