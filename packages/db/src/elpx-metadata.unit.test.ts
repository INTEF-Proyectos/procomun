import { describe, expect, test } from "bun:test";
import { emptyMetadata, parseContentXml } from "./elpx-metadata.ts";

const CONTENT_XML = `<?xml version="1.0" encoding="utf-8"?>
<!DOCTYPE ode SYSTEM "content.dtd">
<ode xmlns="http://www.intef.es/xsd/ode" version="2.0">
  <odeResources>
    <odeResource>
      <key>odeId</key>
      <value>20251125215855LURLBW</value>
    </odeResource>
    <odeResource>
      <key>odeVersionId</key>
      <value>20251125220103ABCXYZ</value>
    </odeResource>
    <odeResource>
      <key>exe_version</key>
      <value>3.0</value>
    </odeResource>
  </odeResources>
  <odeProperties>
    <odeProperty><key>pp_title</key><value>Mi recurso</value></odeProperty>
    <odeProperty><key>pp_author</key><value>Ana</value></odeProperty>
    <odeProperty><key>license</key><value>cc-by</value></odeProperty>
    <odeProperty><key>lom_general_language</key><value>es</value></odeProperty>
  </odeProperties>
</ode>`;

describe("parseContentXml — identificadores eXeLearning (issue #31)", () => {
	test("extrae odeId, odeVersionId y exe_version de odeResources", () => {
		const metadata = parseContentXml(CONTENT_XML);
		expect(metadata.odeId).toBe("20251125215855LURLBW");
		expect(metadata.odeVersionId).toBe("20251125220103ABCXYZ");
		expect(metadata.exeVersion).toBe("3.0");
	});

	test("sigue extrayendo las odeProperties descriptivas", () => {
		const metadata = parseContentXml(CONTENT_XML);
		expect(metadata.title).toBe("Mi recurso");
		expect(metadata.author).toBe("Ana");
		expect(metadata.license).toBe("cc-by");
		expect(metadata.language).toBe("es");
	});

	test("sin odeResources los identificadores quedan vacíos", () => {
		const metadata = parseContentXml(
			`<ode><odeProperties><odeProperty><key>pp_title</key><value>Solo título</value></odeProperty></odeProperties></ode>`,
		);
		expect(metadata.title).toBe("Solo título");
		expect(metadata.odeId).toBe("");
		expect(metadata.odeVersionId).toBe("");
		expect(metadata.exeVersion).toBe("");
	});

	test("emptyMetadata incluye los identificadores vacíos", () => {
		const metadata = emptyMetadata();
		expect(metadata.odeId).toBe("");
		expect(metadata.odeVersionId).toBe("");
		expect(metadata.exeVersion).toBe("");
	});
});
