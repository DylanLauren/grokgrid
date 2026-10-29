// Exact-window, page-only video. No credentials, audio, display capture or UI mutation.
import AppKit
import ScreenCaptureKit
import CoreMedia
import CoreVideo
import Foundation
import Darwin

struct Pin: Decodable {
    let windowId: UInt32, ownerPid: Int32, chromeWindowId: Int
    let title: String, browserUrl: String, width: Int, fps: Int
    let expectedWidth: Int?, expectedHeight: Int?
    let expectedWindowWidth: Int?, expectedWindowHeight: Int?
}
struct Page: Decodable, Equatable {
    let innerWidth: Double, innerHeight: Double, outerWidth: Double, outerHeight: Double, devicePixelRatio: Double
    let href: String, documentTitle: String
}
func stop(_ reason: String) -> Never {
    FileHandle.standardError.write(Data((reason + "\n").utf8))
    exit(reason == "encoder-disconnected" ? 4 : ["capture-stopped", "capture-unavailable"].contains(reason) ? 5 : 3)
}
func quoted(_ value: String) -> String { let encoder=JSONEncoder(); encoder.outputFormatting = .withoutEscapingSlashes; return String(data: try! encoder.encode(value), encoding: .utf8)! }

final class SourceGuard {
    let pin: Pin, script: NSAppleScript, binding: NSAppleScript
    var baseline: String?
    var expectedBounds: CGRect?
    init(_ pin: Pin) {
        self.pin=pin
        let js="JSON.stringify({innerWidth:innerWidth,innerHeight:innerHeight,outerWidth:outerWidth,outerHeight:outerHeight,devicePixelRatio:devicePixelRatio,href:location.href,documentTitle:document.title})"
        let code="tell application \"Google Chrome\" to execute active tab of window id \(pin.chromeWindowId) javascript \(quoted(js))"
        let bind="""
        tell application "Google Chrome"
            set chosen to window id \(pin.chromeWindowId)
            if name of chosen is not \(quoted(pin.title)) then error "source"
            set chosenBounds to bounds of chosen
            set matching to 0
            repeat with candidate in windows
                if (name of candidate is \(quoted(pin.title))) and ((bounds of candidate) is chosenBounds) then set matching to matching + 1
            end repeat
            if matching is not 1 then error "source"
            return chosenBounds
        end tell
        """
        guard let script=NSAppleScript(source:code), let binding=NSAppleScript(source:bind) else {stop("source-check-failed")}
        self.script=script; self.binding=binding
    }
    func read() -> (String,Page,CGRect)? {
        guard let app=NSRunningApplication(processIdentifier:pin.ownerPid),app.bundleIdentifier=="com.google.Chrome",!app.isTerminated else {return nil}
        var error:NSDictionary?
        let bounds:CGRect
        if let expected=expectedBounds {bounds=expected} else {
            let record=binding.executeAndReturnError(&error)
            guard error==nil,record.numberOfItems==4,let x=record.atIndex(1)?.int32Value,let y=record.atIndex(2)?.int32Value,let right=record.atIndex(3)?.int32Value,let bottom=record.atIndex(4)?.int32Value else {return nil}
            bounds=CGRect(x:Int(x),y:Int(y),width:Int(right-x),height:Int(bottom-y))
        }
        // Cheap native metadata verifies position, owner, title and uniqueness.
        // Off-Space windows omitted by CG are independently checked by SCK.
        let items=CGWindowListCopyWindowInfo(.optionAll,kCGNullWindowID) as? [[String:Any]] ?? []
        if let item=items.first(where:{($0[kCGWindowNumber as String] as? UInt32)==pin.windowId}) {
            func matches(_ entry:[String:Any])->Bool {
                guard entry[kCGWindowOwnerPID as String] as? Int32==pin.ownerPid,entry[kCGWindowName as String] as? String==pin.title,
                      let raw=entry[kCGWindowBounds as String] as? [String:Any],let rect=CGRect(dictionaryRepresentation:raw as CFDictionary) else {return false}
                return rect==bounds
            }
            guard matches(item),items.filter(matches).count==1 else {return nil}
        }
        guard let text=script.executeAndReturnError(&error).stringValue,error==nil,let data=text.data(using:.utf8),
              let page=try? JSONDecoder().decode(Page.self,from:data),page.href==pin.browserUrl,page.documentTitle==pin.title else {return nil}
        if let baseline=baseline,baseline != text{return nil}
        return(text,page,bounds)
    }
    func valid()->Bool {
        if Thread.isMainThread{return read() != nil}
        return DispatchQueue.main.sync{self.read() != nil}
    }
}
final class Frames: NSObject, SCStreamOutput, SCStreamDelegate {
    let guardSource: SourceGuard
    let width: Int, height: Int
    let lock = NSLock()
    var cached: Data?
    var capturedAt = Date.distantPast
    var healthyUntil = Date.distantPast
    var emitter: DispatchSourceTimer?
    func healthy() { lock.lock(); healthyUntil=Date().addingTimeInterval(1.5); lock.unlock() }
    func needsRefresh() -> Bool { lock.lock(); defer {lock.unlock()}; return Date().timeIntervalSince(capturedAt)>2 }
    func refresh(_ image: CGImage) {
        guard guardSource.valid(), image.width==width, image.height==height, image.bitsPerPixel==32,
              image.bitsPerComponent==8, image.bitmapInfo.contains(.byteOrder32Little),
              let bytes=image.dataProvider?.data, let base=CFDataGetBytePtr(bytes) else { stop("frame-format-invalid") }
        var data=Data(capacity:width*height*4)
        for row in 0..<height { data.append(base.advanced(by:row*image.bytesPerRow),count:width*4) }
        guard guardSource.valid() else { stop("source-check-failed") }
        lock.lock(); cached=data; capturedAt=Date(); lock.unlock()
    }
    func startEmitter(fps: Int) {
        let timer=DispatchSource.makeTimerSource(queue:DispatchQueue(label:"grokgrid.video.encoder"))
        timer.schedule(deadline:.now(),repeating:1.0/Double(fps))
        timer.setEventHandler { [weak self] in
            guard let self=self else { return }
            self.lock.lock(); let data=self.cached; let healthy=Date()<self.healthyUntil && Date().timeIntervalSince(self.capturedAt)<4; self.lock.unlock()
            guard healthy, let data=data else { return }
            // Static screen pixels are repeated only while the same SCK session
            // and exact source binding remain healthy, as in normal video encoding.
            guard self.guardSource.valid() else { stop("source-check-failed") }
            do { try FileHandle.standardOutput.write(contentsOf:data) } catch { stop("encoder-disconnected") }
        }
        emitter=timer; timer.resume()
    }
    init(_ source: SourceGuard, width: Int, height: Int) { guardSource = source; self.width = width; self.height = height }
    func stream(_ stream: SCStream, didStopWithError error: Error) { stop("capture-stopped") }
    func stream(_ stream: SCStream, didOutputSampleBuffer sampleBuffer: CMSampleBuffer, of type: SCStreamOutputType) {
        guard type == .screen, sampleBuffer.isValid,
              let attachments = CMSampleBufferGetSampleAttachmentsArray(sampleBuffer, createIfNecessary: false) as? [[SCStreamFrameInfo: Any]],
              let raw = attachments.first?[.status] as? Int, SCFrameStatus(rawValue: raw) == .complete,
              let pixel = CMSampleBufferGetImageBuffer(sampleBuffer) else { return }
        // Gate every emitted frame, including a second check after extracting pixels.
        guard guardSource.valid() else { stop("source-check-failed") }
        guard CVPixelBufferGetWidth(pixel) == width, CVPixelBufferGetHeight(pixel) == height,
              CVPixelBufferGetPixelFormatType(pixel) == kCVPixelFormatType_32BGRA else { stop("frame-format-invalid") }
        CVPixelBufferLockBaseAddress(pixel, .readOnly)
        guard let base = CVPixelBufferGetBaseAddress(pixel) else { CVPixelBufferUnlockBaseAddress(pixel, .readOnly); stop("frame-format-invalid") }
        let stride = CVPixelBufferGetBytesPerRow(pixel)
        var data = Data(capacity: width * height * 4)
        for row in 0..<height { data.append(base.advanced(by: row * stride).assumingMemoryBound(to: UInt8.self), count: width * 4) }
        CVPixelBufferUnlockBaseAddress(pixel, .readOnly)
        guard guardSource.valid() else { stop("source-check-failed") }
        lock.lock(); cached=data; capturedAt=Date(); lock.unlock()
    }
}
@main struct VideoCapture {
    @MainActor static func main() async {
        _ = NSApplication.shared
        signal(SIGPIPE, SIG_IGN)
        guard CGPreflightScreenCaptureAccess() else { stop("capture-permission-required") }
        guard let pin = try? JSONDecoder().decode(Pin.self, from: FileHandle.standardInput.readDataToEndOfFile()),
              pin.windowId > 0, pin.ownerPid > 1, pin.chromeWindowId > 0, pin.width == 780, pin.fps == 15,
              let url = URL(string: pin.browserUrl), url.scheme == "https", url.host == "pump.fun", url.user == nil, url.password == nil else { stop("source-config-invalid") }
        let source = SourceGuard(pin)
        guard let (baseline, page, chromeBounds) = source.read() else { stop("source-check-failed") }
        source.baseline = baseline
        do {
            let content = try await SCShareableContent.excludingDesktopWindows(true, onScreenWindowsOnly: false)
            guard let window = content.windows.first(where: { $0.windowID == pin.windowId }), window.owningApplication?.processID == pin.ownerPid,
                  window.owningApplication?.bundleIdentifier == "com.google.Chrome", window.title == pin.title, window.windowLayer == 0 else { stop("window-identity-mismatch") }
            let bounds = window.frame
            guard bounds == chromeBounds, content.windows.filter({$0.owningApplication?.processID == pin.ownerPid && $0.title == pin.title && $0.frame == bounds}).count == 1 else { stop("window-binding-ambiguous") }
            source.expectedBounds = bounds
            if CommandLine.arguments.contains("--prepare") {
                guard let desiredWidth=pin.expectedWindowWidth,let desiredHeight=pin.expectedWindowHeight,
                      desiredWidth>=250,desiredWidth<=1000,desiredHeight>=400,desiredHeight<=1800,
                      Double(desiredWidth)/Double(desiredHeight)>=0.35,Double(desiredWidth)/Double(desiredHeight)<=0.85 else {stop("source-config-invalid")}
                let needsResize=Int(bounds.width) != desiredWidth || Int(bounds.height) != desiredHeight
                guard source.valid() else {stop("source-check-failed")}
                if needsResize {
                let left=Int(bounds.minX),top=Int(bounds.minY)
                let resize="""
                tell application "Google Chrome"
                    set chosen to window id \(pin.chromeWindowId)
                    if name of chosen is not \(quoted(pin.title)) then error "source"
                    if URL of active tab of chosen is not \(quoted(pin.browserUrl)) then error "source"
                    if bounds of chosen is not {\(left),\(top),\(Int(bounds.maxX)),\(Int(bounds.maxY))} then error "source"
                    set bounds of chosen to {\(left),\(top),\(left+desiredWidth),\(top+desiredHeight)}
                end tell
                """
                var resizeError:NSDictionary?
                guard let operation=NSAppleScript(source:resize) else {stop("source-check-failed")}
                _=operation.executeAndReturnError(&resizeError)
                guard resizeError==nil else {stop("source-size-unrestorable")}
                }
                source.baseline=nil;source.expectedBounds=nil
                for _ in 0..<10 {
                    try await Task.sleep(nanoseconds:150_000_000)
                    guard let (_,currentPage,currentBounds)=source.read() else {continue}
                    let updated=try await SCShareableContent.excludingDesktopWindows(true,onScreenWindowsOnly:false)
                    if let current=updated.windows.first(where:{$0.windowID==pin.windowId}),current.owningApplication?.processID==pin.ownerPid,
                       current.owningApplication?.bundleIdentifier=="com.google.Chrome",current.title==pin.title,current.windowLayer==0,
                       current.frame==currentBounds,currentBounds.origin==bounds.origin,
                       Int(currentBounds.width)==desiredWidth,Int(currentBounds.height)==desiredHeight,
                       abs(currentPage.outerWidth-currentBounds.width)<=2,abs(currentPage.outerHeight-currentBounds.height)<=2,
                       currentPage.innerWidth>0,currentPage.innerHeight>0,currentPage.devicePixelRatio>0,
                       updated.windows.filter({$0.owningApplication?.processID==pin.ownerPid && $0.title==pin.title && $0.frame==currentBounds}).count==1 {
                        let pixelScale=Double(SCContentFilter(desktopIndependentWindow:current).pointPixelScale)
                        let pageHeight=currentPage.innerHeight*currentBounds.width/currentPage.innerWidth
                        let pageTop=currentBounds.height-pageHeight
                        guard abs(currentBounds.width*pixelScale/currentPage.innerWidth-currentPage.devicePixelRatio)<0.02,
                              pageTop>=0,pageTop<=currentBounds.height*0.35 else {continue}
                        print("{\"state\":\"source-size-verified\",\"changed\":\(needsResize)}");return
                    }
                }
                stop("source-size-unrestorable")
            }
            if let expected=pin.expectedWindowWidth,Int(bounds.width) != expected {stop("source-size-mismatch")}
            if let expected=pin.expectedWindowHeight,Int(bounds.height) != expected {stop("source-size-mismatch")}
            let values = [page.innerWidth,page.innerHeight,page.outerWidth,page.outerHeight,page.devicePixelRatio,bounds.width,bounds.height]
            guard values.allSatisfy({$0.isFinite && $0 > 0}), abs(page.outerWidth-bounds.width) <= 2, abs(page.outerHeight-bounds.height) <= 2,
                  bounds.width >= 250, bounds.height >= 400, bounds.width/bounds.height >= 0.35, bounds.width/bounds.height <= 0.85 else { stop("viewport-invalid") }
            let filter = SCContentFilter(desktopIndependentWindow: window)
            let scale = Double(filter.pointPixelScale), pixelPerCss = bounds.width * scale / page.innerWidth
            let contentHeight = page.innerHeight * bounds.width / page.innerWidth
            let top = bounds.height-contentHeight
            guard abs(pixelPerCss-page.devicePixelRatio) < 0.02, top >= 0, top <= bounds.height * 0.35 else { stop("viewport-invalid") }
            let width = min(pin.width, Int(bounds.width * scale)) / 2 * 2
            let height = Int(contentHeight * Double(width) / bounds.width) / 2 * 2
            if let expectedWidth = pin.expectedWidth, expectedWidth != width { stop("viewport-changed") }
            if let expectedHeight = pin.expectedHeight, expectedHeight != height { stop("viewport-changed") }
            if CommandLine.arguments.contains("--check") {
                print("{\"width\":\(width),\"height\":\(height),\"fps\":\(pin.fps),\"onScreen\":\(window.isOnScreen)}")
                return
            }
            let config = SCStreamConfiguration()
            config.width = width; config.height = height; config.pixelFormat = kCVPixelFormatType_32BGRA
            config.sourceRect = CGRect(x: 0, y: top, width: bounds.width, height: contentHeight)
            config.minimumFrameInterval = CMTime(value: 1, timescale: Int32(pin.fps)); config.queueDepth = 3
            config.capturesAudio = false; config.showsCursor = false; config.ignoreShadowsSingleWindow = true
            config.includeChildWindows = false; config.scalesToFit = true; config.preservesAspectRatio = true
            let frames = Frames(source, width: width, height: height)
            let stream = SCStream(filter: filter, configuration: config, delegate: frames)
            try stream.addStreamOutput(frames, type: .screen, sampleHandlerQueue: DispatchQueue(label: "grokgrid.video.frames"))
            try await stream.startCapture()
            frames.healthy(); frames.startEmitter(fps:pin.fps)
            let parent = getppid()
            while getppid() == parent && parent > 1 {
                try await Task.sleep(nanoseconds: 500_000_000)
                guard source.valid() else { stop("source-check-failed") }
                let fresh = try await SCShareableContent.excludingDesktopWindows(true, onScreenWindowsOnly: false)
                guard let current = fresh.windows.first(where: {$0.windowID == pin.windowId}), current.owningApplication?.processID == pin.ownerPid,
                      current.owningApplication?.bundleIdentifier == "com.google.Chrome", current.title == pin.title, current.frame == bounds, current.windowLayer == 0, fresh.windows.filter({$0.owningApplication?.processID == pin.ownerPid && $0.title == pin.title && $0.frame == bounds}).count == 1 else { stop("window-identity-mismatch") }
                frames.healthy()
                // Refresh an unchanged page from the same window every two
                // seconds; never present an indefinitely cached image as live.
                if frames.needsRefresh() {
                    guard source.valid() else { stop("source-check-failed") }
                    let currentImage = try await SCScreenshotManager.captureImage(contentFilter:filter, configuration:config)
                    frames.refresh(currentImage)
                }
            }
            try await stream.stopCapture()
        } catch { stop("capture-unavailable") }
    }
}
