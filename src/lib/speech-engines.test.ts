import { describe, expect, it } from "vitest"

import {
  createRecognitionTextTracker,
  type RecognitionEventLike,
} from "./speech-engines"

type Result = [transcript: string, isFinal: boolean]

function event(resultIndex: number, results: Result[]): RecognitionEventLike {
  return {
    resultIndex,
    results: results.map(([transcript, isFinal]) =>
      Object.assign([{ transcript }], { isFinal })
    ),
  }
}

describe("createRecognitionTextTracker - desktop", () => {
  it("delivers each final once and skips a re-sent slot", () => {
    const tracker = createRecognitionTextTracker(false)
    expect(tracker.update(event(0, [["hello wor", false]]))).toEqual({
      finals: [],
      interim: "hello wor",
    })
    expect(tracker.update(event(0, [[" hello world ", true]]))).toEqual({
      finals: ["hello world"],
      interim: "",
    })
    expect(
      tracker.update(
        event(0, [
          ["hello world", true],
          ["again", true],
        ])
      ).finals
    ).toEqual(["again"])
  })

  it("keeps a phrase that is legitimately said twice", () => {
    const tracker = createRecognitionTextTracker(false)
    tracker.update(event(0, [["yes", true]]))
    expect(
      tracker.update(
        event(1, [
          ["yes", true],
          ["yes", true],
        ])
      ).finals
    ).toEqual(["yes"])
  })
})

describe("createRecognitionTextTracker - Android", () => {
  it("drops a final that repeats the previous phrase in slot 0", () => {
    const tracker = createRecognitionTextTracker(true)
    expect(tracker.update(event(0, [["open the", true]])).finals).toEqual([
      "open the",
    ])
    expect(tracker.update(event(0, [["open the", true]])).finals).toEqual([])
    expect(tracker.update(event(0, [["pull request", true]])).finals).toEqual([
      "pull request",
    ])
  })

  it("keeps only the new words of a cumulative final", () => {
    const tracker = createRecognitionTextTracker(true)
    tracker.update(event(0, [["open", true]]))
    expect(tracker.update(event(0, [["open the pull", false]])).interim).toBe(
      "the pull"
    )
    expect(
      tracker.update(event(0, [["Open the pull request.", true]])).finals
    ).toEqual(["the pull request."])
    expect(
      tracker.update(event(0, [["open the pull request please", true]])).finals
    ).toEqual(["please"])
  })

  it("strips a restatement whose earlier words were rewritten", () => {
    const tracker = createRecognitionTextTracker(true)
    expect(
      tracker.update(
        event(0, [
          ["great it works I'd like to test the workspace assistant", true],
        ])
      ).finals
    ).toEqual(["great it works I'd like to test the workspace assistant"])
    expect(
      tracker.update(
        event(0, [
          [
            "great it works I would like to test the workspace assistant now however",
            true,
          ],
        ])
      ).finals
    ).toEqual(["now however"])
  })

  it("keeps a new phrase that only shares a few words with the last one", () => {
    const tracker = createRecognitionTextTracker(true)
    tracker.update(event(0, [["open the pull request", true]]))
    expect(
      tracker.update(event(0, [["close the issue then open request", true]]))
        .finals
    ).toEqual(["close the issue then open request"])
  })

  it("strips a restatement of only the previous phrase", () => {
    const tracker = createRecognitionTextTracker(true)
    tracker.update(event(0, [["first part", true]]))
    tracker.update(event(0, [["second part", true]]))
    expect(
      tracker.update(event(0, [["second part and more", true]])).finals
    ).toEqual(["and more"])
  })
})
