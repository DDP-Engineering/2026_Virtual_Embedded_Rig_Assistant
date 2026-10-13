# Try VERA on VERA-DEMO-01

This fictional revision A board is a complete example. Its specifications and measurements
are demonstration data. No physical hardware is required.

1. Open the demo from Welcome. VERA keeps your own copy and remembers it in recent workbenches.
2. Configure a provider in App Settings, or connect your supported subscription. Return to
   Welcome using the workbench name in the sidebar.
3. Choose one of the three suggested prompts below. A new session opens with an editable
   draft. Select a model in the composer, review the prompt and press Send.
4. Open source citations to inspect the answer. The Docs tab shows indexing progress;
   English Markdown sources are also available while PDF indexing finishes.

## Read a datasheet

Use the datasheet-reader skill. Which pins carry SDA and SCL on revision A, what pull-ups
and supply limits apply, and how does the pinout agree with the datasheet? Cite the sources.

## Analyze a boot log

Use the log-analyst skill to analyze logs/boot-0412.log. What does the I2C warning show,
what happened afterward, and what remains unverified? Cite the log and relevant notes.

## Plan bring-up

Use the bringup-checklist skill. Draft a first-power-up checklist from the application
note, pinout, notes and boot log. Separate recorded evidence from checks still to measure
and cite each source. Answer in chat.

## Explore the example

- `docs/`: generated datasheet, reference manual and application note, pinout and bring-up notes.
- `logs/boot-0412.log`: supplied boot capture with an I2C warning followed by ready.
- `sources/`: English text matching the three PDF documents.
- `skills/`: three readable procedures; inspect them in Workbench settings → Skills.
- `WORKBENCH.md`: board and bench context used in every conversation.

The example log does not prove every acceptance check. A useful answer explains what is
known and what evidence is still missing. You can return to Welcome to try another prompt.
