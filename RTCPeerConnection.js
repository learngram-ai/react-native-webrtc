"use strict";

import EventTarget from "event-target-shim";
import { NativeModules, NativeEventEmitter } from "react-native";

import MediaStream from "./MediaStream";
import MediaStreamEvent from "./MediaStreamEvent";
import MediaStreamTrack from "./MediaStreamTrack";
import MediaStreamTrackEvent from "./MediaStreamTrackEvent";
import RTCDataChannel from "./RTCDataChannel";
import RTCDataChannelEvent from "./RTCDataChannelEvent";
import RTCSessionDescription from "./RTCSessionDescription";
import RTCIceCandidate from "./RTCIceCandidate";
import RTCIceCandidateEvent from "./RTCIceCandidateEvent";
import RTCEvent from "./RTCEvent";
import * as RTCUtil from "./RTCUtil";
import EventEmitter from "./EventEmitter";

const { WebRTCModule } = NativeModules;

type RTCSignalingState =
  | "stable"
  | "have-local-offer"
  | "have-remote-offer"
  | "have-local-pranswer"
  | "have-remote-pranswer"
  | "closed";

type RTCIceGatheringState = "new" | "gathering" | "complete";

type RTCPeerConnectionState =
  | "new"
  | "connecting"
  | "connected"
  | "disconnected"
  | "failed"
  | "closed";

type RTCIceConnectionState =
  | "new"
  | "checking"
  | "connected"
  | "completed"
  | "failed"
  | "disconnected"
  | "closed";

const PEER_CONNECTION_EVENTS = [
  "connectionstatechange",
  "icecandidate",
  "icecandidateerror",
  "iceconnectionstatechange",
  "icegatheringstatechange",
  "negotiationneeded",
  "signalingstatechange",
  // Peer-to-peer Data API:
  "datachannel",
  // old:
  "addstream",
  "removestream",
];

let nextPeerConnectionId = 0;

export default class RTCPeerConnection extends EventTarget(
  PEER_CONNECTION_EVENTS
) {
  localDescription: RTCSessionDescription;
  remoteDescription: RTCSessionDescription;

  signalingState: RTCSignalingState = "stable";
  iceGatheringState: RTCIceGatheringState = "new";
  connectionState: RTCPeerConnectionState = "new";
  iceConnectionState: RTCIceConnectionState = "new";

  onconnectionstatechange: ?Function;
  onicecandidate: ?Function;
  onicecandidateerror: ?Function;
  oniceconnectionstatechange: ?Function;
  onicegatheringstatechange: ?Function;
  onnegotiationneeded: ?Function;
  onsignalingstatechange: ?Function;

  onaddstream: ?Function;
  onremovestream: ?Function;

  _peerConnectionId: number;
  _localStreams: Array<MediaStream> = [];
  _remoteStreams: Array<MediaStream> = [];
  _subscriptions: Array<any>;

  /**
   * The RTCDataChannel.id allocator of this RTCPeerConnection.
   */
  _dataChannelIds: Set = new Set();

  constructor(configuration) {
    super();
    console.log("🔥 🔥 react-native-webrtc constructor start");
    this._peerConnectionId = nextPeerConnectionId++;
    WebRTCModule.peerConnectionInit(configuration, this._peerConnectionId);
    this._registerEvents();

    this.onaddstream = (
      ...args // eslint-disable-line no-shadow
    ) =>
      (this._onaddstreamQueue
        ? this._queueOnaddstream
        : this._invokeOnaddstream
      ).apply(this, args);

    // // Shadow RTCPeerConnection's onaddstream but after _RTCPeerConnection has
    // // assigned to the property in question. Defining the property on
    // // _RTCPeerConnection's prototype may (or may not, I don't know) work but I
    // // don't want to try because the following approach appears to work and I
    // // understand it.

    // $FlowFixMe
    Object.defineProperty(this, "onaddstream", {
      configurable: true,
      enumerable: true,
      get() {
        console.log(
          "🔥 _RTCPeerConnection Object.defineProperty(this, onaddstream - get"
        );
        return this._onaddstream;
      },
      set(value) {
        console.log(
          "🔥 _RTCPeerConnection Object.defineProperty(this, onaddstream - set start"
        );
        this._onaddstream = value;
        console.log(
          "🔥 _RTCPeerConnection Object.defineProperty(this, onaddstream - set end"
        );
      },
    });

    console.log("🔥 🔥 react-native-webrtc constructor end");
  }

  _invokeOnaddstream = function (...args) {
    console.log("🔥 _RTCPeerConnection _invokeOnaddstream start");

    const onaddstream = this._onaddstream;

    console.log("🔥 _RTCPeerConnection _invokeOnaddstream end");

    return onaddstream && onaddstream.apply(this, args);
  };

  _invokeQueuedOnaddstream = function (q) {
    console.log("🔥 _RTCPeerConnection _invokeQueuedOnaddstream start");
    q &&
      q.forEach((args) => {
        try {
          this._invokeOnaddstream(...args);
        } catch (e) {
          // TODO Determine whether the combination of the standard
          // setRemoteDescription and onaddstream results in a similar
          // swallowing of errors.
          console.error(e);
        }
      });
    console.log("🔥 _RTCPeerConnection _invokeQueuedOnaddstream end");
  };

  _queueOnaddstream = function (...args) {
    console.log("🔥 _RTCPeerConnection _queueOnaddstream start");

    this._onaddstreamQueue.push(Array.from(args));

    console.log("🔥 _RTCPeerConnection _queueOnaddstream end");
  };

  setRemoteDescription = function (description) {
    console.log("🔥 _RTCPeerConnection setRemoteDescription start");

    return _synthesizeIPv6Addresses(description)
      .catch((reason) => {
        reason && console.error(reason);

        return description;
      })
      .then((value) => _setRemoteDescription.bind(this)(value));
  };

  addStream(stream: MediaStream) {
    console.log("🔥 🔥 react-native-webrtc addStream start");
    const index = this._localStreams.indexOf(stream);
    if (index !== -1) {
      return;
    }
    WebRTCModule.peerConnectionAddStream(
      stream._reactTag,
      this._peerConnectionId
    );
    this._localStreams.push(stream);
    console.log("🔥 🔥 react-native-webrtc addStream end");
  }

  removeStream(stream: MediaStream) {
    console.log("🔥 🔥 react-native-webrtc removeStream start");

    const index = this._localStreams.indexOf(stream);
    if (index === -1) {
      return;
    }
    this._localStreams.splice(index, 1);
    WebRTCModule.peerConnectionRemoveStream(
      stream._reactTag,
      this._peerConnectionId
    );
    console.log("🔥 🔥 react-native-webrtc removeStream end");
  }

  createOffer(options) {
    console.log("🔥 🔥 react-native-webrtc createOffer start");
    return new Promise((resolve, reject) => {
      WebRTCModule.peerConnectionCreateOffer(
        this._peerConnectionId,
        RTCUtil.normalizeOfferAnswerOptions(options),
        (successful, data) => {
          if (successful) {
            resolve(new RTCSessionDescription(data));
          } else {
            reject(data); // TODO: convert to NavigatorUserMediaError
          }
        }
      );
    });
  }

  createAnswer(options = {}) {
    console.log("🔥 🔥 react-native-webrtc createAnswer start");

    return new Promise((resolve, reject) => {
      WebRTCModule.peerConnectionCreateAnswer(
        this._peerConnectionId,
        RTCUtil.normalizeOfferAnswerOptions(options),
        (successful, data) => {
          if (successful) {
            resolve(new RTCSessionDescription(data));
          } else {
            reject(data);
          }
        }
      );
    });
  }

  setConfiguration(configuration) {
    console.log("🔥 🔥 react-native-webrtc setConfiguration start");

    WebRTCModule.peerConnectionSetConfiguration(
      configuration,
      this._peerConnectionId
    );
    console.log("🔥 🔥 react-native-webrtc setConfiguration end");
  }

  setLocalDescription(sessionDescription: RTCSessionDescription) {
    console.log("🔥 🔥 react-native-webrtc setLocalDescription start");

    return new Promise((resolve, reject) => {
      WebRTCModule.peerConnectionSetLocalDescription(
        sessionDescription.toJSON
          ? sessionDescription.toJSON()
          : sessionDescription,
        this._peerConnectionId,
        (successful, data) => {
          if (successful) {
            this.localDescription = sessionDescription;
            resolve();
          } else {
            reject(data);
          }
        }
      );
    });
  }

  setRemoteDescription2(sessionDescription: RTCSessionDescription) {
    console.log("🔥 🔥 react-native-webrtc setRemoteDescription start");

    return new Promise((resolve, reject) => {
      WebRTCModule.peerConnectionSetRemoteDescription(
        sessionDescription.toJSON
          ? sessionDescription.toJSON()
          : sessionDescription,
        this._peerConnectionId,
        (successful, data) => {
          if (successful) {
            this.remoteDescription = sessionDescription;
            resolve();
          } else {
            reject(data);
          }
        }
      );
    });
  }

  addIceCandidate(candidate) {
    console.log("🔥 🔥 react-native-webrtc addIceCandidate start");

    return new Promise((resolve, reject) => {
      WebRTCModule.peerConnectionAddICECandidate(
        candidate.toJSON ? candidate.toJSON() : candidate,
        this._peerConnectionId,
        (successful) => {
          if (successful) {
            resolve();
          } else {
            // XXX: This should be OperationError
            reject(new Error("Failed to add ICE candidate"));
          }
        }
      );
    });
  }

  getStats(track) {
    console.log("🔥 🔥 react-native-webrtc getStats start");

    // NOTE: This returns a Promise but the format of the results is still
    // the "legacy" one. The native side (in Oobj-C) doesn't yet support the
    // new format: https://bugs.chromium.org/p/webrtc/issues/detail?id=6872
    return new Promise((resolve, reject) => {
      WebRTCModule.peerConnectionGetStats(
        (track && track.id) || "",
        this._peerConnectionId,
        (success, data) => {
          if (success) {
            // On both Android and iOS it is faster to construct a single
            // JSON string representing the array of StatsReports and have it
            // pass through the React Native bridge rather than the array of
            // StatsReports. While the implementations do try to be faster in
            // general, the stress is on being faster to pass through the React
            // Native bridge which is a bottleneck that tends to be visible in
            // the UI when there is congestion involving UI-related passing.
            try {
              const stats = JSON.parse(data);
              resolve(stats);
            } catch (e) {
              reject(e);
            }
          } else {
            reject(new Error(data));
          }
        }
      );
    });
  }

  getLocalStreams() {
    console.log("🔥 🔥 react-native-webrtc getLocalStreams start");

    return this._localStreams.slice();
  }

  getRemoteStreams() {
    console.log("🔥 🔥 react-native-webrtc getRemoteStreams start");

    return this._remoteStreams.slice();
  }

  close() {
    console.log("🔥 🔥 react-native-webrtc close start");
    WebRTCModule.peerConnectionClose(this._peerConnectionId);
  }

  _getTrack(streamReactTag, trackId): MediaStreamTrack {
    console.log("🔥 🔥 react-native-webrtc _getTrack start");

    const stream = this._remoteStreams.find(
      (stream) => stream._reactTag === streamReactTag
    );

    console.log("🔥 🔥 react-native-webrtc _getTrack end");

    return stream && stream._tracks.find((track) => track.id === trackId);
  }

  _unregisterEvents(): void {
    console.log("🔥 🔥 react-native-webrtc _unregisterEvents start");

    this._subscriptions.forEach((e) => e.remove());
    this._subscriptions = [];
    console.log("🔥 🔥 react-native-webrtc _unregisterEvents end");
  }

  _registerEvents(): void {
    console.log("🔥 🔥 react-native-webrtc _registerEvents start");

    this._subscriptions = [
      EventEmitter.addListener("peerConnectionOnRenegotiationNeeded", (ev) => {
        if (ev.id !== this._peerConnectionId) {
          return;
        }
        this.dispatchEvent(new RTCEvent("negotiationneeded"));
      }),
      EventEmitter.addListener("peerConnectionIceConnectionChanged", (ev) => {
        if (ev.id !== this._peerConnectionId) {
          return;
        }
        this.iceConnectionState = ev.iceConnectionState;
        this.dispatchEvent(new RTCEvent("iceconnectionstatechange"));
        if (ev.iceConnectionState === "closed") {
          // This PeerConnection is done, clean up event handlers.
          this._unregisterEvents();
        }
      }),
      EventEmitter.addListener("peerConnectionStateChanged", (ev) => {
        if (ev.id !== this._peerConnectionId) {
          return;
        }
        this.connectionState = ev.connectionState;
        this.dispatchEvent(new RTCEvent("connectionstatechange"));
        if (ev.connectionState === "closed") {
          // This PeerConnection is done, clean up event handlers.
          this._unregisterEvents();
        }
      }),
      EventEmitter.addListener("peerConnectionSignalingStateChanged", (ev) => {
        if (ev.id !== this._peerConnectionId) {
          return;
        }
        this.signalingState = ev.signalingState;
        this.dispatchEvent(new RTCEvent("signalingstatechange"));
      }),
      EventEmitter.addListener("peerConnectionAddedStream", (ev) => {
        if (ev.id !== this._peerConnectionId) {
          return;
        }
        const stream = new MediaStream(ev);
        this._remoteStreams.push(stream);
        this.dispatchEvent(new MediaStreamEvent("addstream", { stream }));
      }),
      EventEmitter.addListener("peerConnectionRemovedStream", (ev) => {
        if (ev.id !== this._peerConnectionId) {
          return;
        }
        const stream = this._remoteStreams.find(
          (s) => s._reactTag === ev.streamId
        );
        if (stream) {
          const index = this._remoteStreams.indexOf(stream);
          if (index !== -1) {
            this._remoteStreams.splice(index, 1);
          }
        }
        this.dispatchEvent(new MediaStreamEvent("removestream", { stream }));
      }),
      EventEmitter.addListener("mediaStreamTrackMuteChanged", (ev) => {
        if (ev.peerConnectionId !== this._peerConnectionId) {
          return;
        }
        const track = this._getTrack(ev.streamReactTag, ev.trackId);
        if (track) {
          track.muted = ev.muted;
          const eventName = ev.muted ? "mute" : "unmute";
          track.dispatchEvent(new MediaStreamTrackEvent(eventName, { track }));
        }
      }),
      EventEmitter.addListener("peerConnectionGotICECandidate", (ev) => {
        if (ev.id !== this._peerConnectionId) {
          return;
        }
        const candidate = new RTCIceCandidate(ev.candidate);
        const event = new RTCIceCandidateEvent("icecandidate", { candidate });
        this.dispatchEvent(event);
      }),
      EventEmitter.addListener("peerConnectionIceGatheringChanged", (ev) => {
        if (ev.id !== this._peerConnectionId) {
          return;
        }
        this.iceGatheringState = ev.iceGatheringState;

        if (this.iceGatheringState === "complete") {
          this.dispatchEvent(new RTCIceCandidateEvent("icecandidate", null));
        }

        this.dispatchEvent(new RTCEvent("icegatheringstatechange"));
      }),
      EventEmitter.addListener("peerConnectionDidOpenDataChannel", (ev) => {
        if (ev.id !== this._peerConnectionId) {
          return;
        }
        const evDataChannel = ev.dataChannel;
        const id = evDataChannel.id;
        // XXX RTP data channels are not defined by the WebRTC standard, have
        // been deprecated in Chromium, and Google have decided (in 2015) to no
        // longer support them (in the face of multiple reported issues of
        // breakages).
        if (typeof id !== "number" || id === -1) {
          return;
        }
        const channel = new RTCDataChannel(
          this._peerConnectionId,
          evDataChannel.label,
          evDataChannel
        );
        // XXX webrtc::PeerConnection checked that id was not in use in its own
        // SID allocator before it invoked us. Additionally, its own SID
        // allocator is the authority on ResourceInUse. Consequently, it is
        // (pretty) safe to update our RTCDataChannel.id allocator without
        // checking for ResourceInUse.
        this._dataChannelIds.add(id);
        this.dispatchEvent(new RTCDataChannelEvent("datachannel", { channel }));
      }),
    ];
    console.log("🔥 🔥 react-native-webrtc _registerEvents end");
  }

  /**
   * Creates a new RTCDataChannel object with the given label. The
   * RTCDataChannelInit dictionary can be used to configure properties of the
   * underlying channel such as data reliability.
   *
   * @param {string} label - the value with which the label attribute of the new
   * instance is to be initialized
   * @param {RTCDataChannelInit} dataChannelDict - an optional dictionary of
   * values with which to initialize corresponding attributes of the new
   * instance such as id
   */
  createDataChannel(label: string, dataChannelDict?: ?RTCDataChannelInit) {
    console.log("🔥 🔥 react-native-webrtc createDataChannel start");

    let id;
    const dataChannelIds = this._dataChannelIds;
    if (dataChannelDict && "id" in dataChannelDict) {
      id = dataChannelDict.id;
      if (typeof id !== "number") {
        throw new TypeError("DataChannel id must be a number: " + id);
      }
      if (dataChannelIds.has(id)) {
        throw new ResourceInUse("DataChannel id already in use: " + id);
      }
    } else {
      // Allocate a new id.
      // TODO Remembering the last used/allocated id and then incrementing it to
      // generate the next id to use will surely be faster. However, I want to
      // reuse ids (in the future) as the RTCDataChannel.id space is limited to
      // unsigned short by the standard:
      // https://www.w3.org/TR/webrtc/#dom-datachannel-id. Additionally, 65535
      // is reserved due to SCTP INIT and INIT-ACK chunks only allowing a
      // maximum of 65535 streams to be negotiated (as defined by the WebRTC
      // Data Channel Establishment Protocol).
      for (id = 1; id < 65535 && dataChannelIds.has(id); ++id);
      // TODO Throw an error if no unused id is available.
      dataChannelDict = Object.assign({ id }, dataChannelDict);
    }
    WebRTCModule.createDataChannel(
      this._peerConnectionId,
      label,
      dataChannelDict
    );
    dataChannelIds.add(id);
    console.log("🔥 🔥 react-native-webrtc createDataChannel end");
    return new RTCDataChannel(this._peerConnectionId, label, dataChannelDict);
  }
}


/**
 * Adapts react-native-webrtc's {@link RTCPeerConnection#setRemoteDescription}
 * implementation which uses the deprecated, callback-based version to the
 * {@code Promise}-based version.
 *
 * @param {RTCSessionDescription} description - The RTCSessionDescription
 * which specifies the configuration of the remote end of the connection.
 * @private
 * @private
 * @returns {Promise}
 */
function _setRemoteDescription(description) {
  console.log("🔥 _RTCPeerConnection _setRemoteDescription start");

  return new Promise((resolve, reject) => {
    /* eslint-disable no-invalid-this */

    // Ensure I'm not remembering onaddstream invocations from previous
    // setRemoteDescription calls. I shouldn't be but... anyway.
    this._onaddstreamQueue = [];

    RTCPeerConnection.prototype.setRemoteDescription2
      .call(this, description)
      .then(
        (...args) => {
          let q;

          try {
            resolve(...args);
          } finally {
            q = this._onaddstreamQueue;
            this._onaddstreamQueue = undefined;
          }

          this._invokeQueuedOnaddstream(q);
        },
        (...args) => {
          this._onaddstreamQueue = undefined;

          reject(...args);
        }
      );

    /* eslint-enable no-invalid-this */
  });
}

// XXX The function _synthesizeIPv6FromIPv4Address is not placed relative to the
// other functions in the file according to alphabetical sorting rule of the
// coding style. But eslint wants constants to be defined before they are used.

/**
 * Synthesizes an IPv6 address from a specific IPv4 address.
 *
 * @param {string} ipv4 - The IPv4 address from which an IPv6 address is to be
 * synthesized.
 * @returns {Promise<?string>} A {@code Promise} which gets resolved with the
 * IPv6 address synthesized from the specified {@code ipv4} or a falsy value to
 * be treated as inability to synthesize an IPv6 address from the specified
 * {@code ipv4}.
 */
const _synthesizeIPv6FromIPv4Address: (string) => Promise<?string> = (function () {
  console.log("🔥 _RTCPeerConnection _synthesizeIPv6FromIPv4Address start");

  // POSIX.getaddrinfo
  const { POSIX } = NativeModules;

  if (POSIX) {
    const { getaddrinfo } = POSIX;

    if (typeof getaddrinfo === "function") {
      return (ipv4) =>
        getaddrinfo(/* hostname */ ipv4, /* servname */ undefined).then(
          ([{ ai_addr: ipv6 }]) => ipv6
        );
    }
  }

  // NAT64AddrInfo.getIPv6Address
  const { NAT64AddrInfo } = NativeModules;

  if (NAT64AddrInfo) {
    const { getIPv6Address } = NAT64AddrInfo;

    if (typeof getIPv6Address === "function") {
      return getIPv6Address;
    }
  }

  // There's no POSIX.getaddrinfo or NAT64AddrInfo.getIPv6Address.
  console.log("🔥 _RTCPeerConnection _synthesizeIPv6FromIPv4Address end");

  return () =>
    Promise.reject(
      "The impossible just happened! No POSIX.getaddrinfo or" +
        " NAT64AddrInfo.getIPv6Address!"
    );
})();

/**
 * Synthesizes IPv6 addresses on iOS in order to support IPv6 NAT64 networks.
 *
 * @param {RTCSessionDescription} sdp - The RTCSessionDescription which
 * specifies the configuration of the remote end of the connection.
 * @private
 * @returns {Promise}
 */
function _synthesizeIPv6Addresses(sdp) {
  console.log("🔥 _RTCPeerConnection _synthesizeIPv6Addresses start");

  return new Promise((resolve) =>
    resolve(_synthesizeIPv6Addresses0(sdp))
  ).then(({ ips, lines }) =>
    Promise.all(Array.from(ips.values())).then(() =>
      _synthesizeIPv6Addresses1(sdp, ips, lines)
    )
  );
}

/* eslint-disable max-depth */

/**
 * Begins the asynchronous synthesis of IPv6 addresses.
 *
 * @param {RTCSessionDescription} sessionDescription - The RTCSessionDescription
 * for which IPv6 addresses will be synthesized.
 * @private
 * @returns {{
 *     ips: Map,
 *     lines: Array
 * }}
 */
function _synthesizeIPv6Addresses0(sessionDescription) {
  console.log("🔥 _RTCPeerConnection _synthesizeIPv6Addresses0 start");

  const sdp = sessionDescription.sdp;
  let start = 0;
  const lines = [];
  const ips = new Map();

  do {
    const end = sdp.indexOf("\r\n", start);
    let line;

    if (end === -1) {
      line = sdp.substring(start);

      // Break out of the loop at the end of the iteration.
      start = undefined;
    } else {
      line = sdp.substring(start, end);
      start = end + 2;
    }

    if (line.startsWith("a=candidate:")) {
      const candidate = line.split(" ");

      if (candidate.length >= 10 && candidate[6] === "typ") {
        const ip4s = [candidate[4]];
        let abort = false;

        for (let i = 8; i < candidate.length; ++i) {
          if (candidate[i] === "raddr") {
            ip4s.push(candidate[++i]);
            break;
          }
        }

        for (const ip of ip4s) {
          if (ip.indexOf(":") === -1) {
            ips.has(ip) ||
              ips.set(
                ip,
                new Promise((resolve, reject) => {
                  const v = ips.get(ip);

                  if (v && typeof v === "string") {
                    resolve(v);
                  } else {
                    _synthesizeIPv6FromIPv4Address(ip).then((value) => {
                      if (
                        !value ||
                        value.indexOf(":") === -1 ||
                        value === ips.get(ip)
                      ) {
                        ips.delete(ip);
                      } else {
                        ips.set(ip, value);
                      }
                      resolve(value);
                    }, reject);
                  }
                })
              );
          } else {
            abort = true;
            break;
          }
        }
        if (abort) {
          ips.clear();
          break;
        }

        line = candidate;
      }
    }

    lines.push(line);
  } while (start);
  console.log("🔥 _RTCPeerConnection _synthesizeIPv6Addresses0 end");

  return {
    ips,
    lines,
  };
}

/* eslint-enable max-depth */

/**
 * Completes the asynchronous synthesis of IPv6 addresses.
 *
 * @param {RTCSessionDescription} sessionDescription - The RTCSessionDescription
 * for which IPv6 addresses are being synthesized.
 * @param {Map} ips - A Map of IPv4 addresses found in the specified
 * sessionDescription to synthesized IPv6 addresses.
 * @param {Array} lines - The lines of the specified sessionDescription.
 * @private
 * @returns {RTCSessionDescription} A RTCSessionDescription that represents the
 * result of the synthesis of IPv6 addresses.
 */
function _synthesizeIPv6Addresses1(sessionDescription, ips, lines) {
  console.log("🔥 _RTCPeerConnection _synthesizeIPv6Addresses1 start");

  if (ips.size === 0) {
    return sessionDescription;
  }

  for (let l = 0; l < lines.length; ++l) {
    const candidate = lines[l];

    if (typeof candidate !== "string") {
      let ip4 = candidate[4];
      let ip6 = ips.get(ip4);

      ip6 && (candidate[4] = ip6);

      for (let i = 8; i < candidate.length; ++i) {
        if (candidate[i] === "raddr") {
          ip4 = candidate[++i];
          (ip6 = ips.get(ip4)) && (candidate[i] = ip6);
          break;
        }
      }

      lines[l] = candidate.join(" ");
    }
  }
  console.log("🔥 _RTCPeerConnection _synthesizeIPv6Addresses1 end");

  return new RTCSessionDescription({
    sdp: lines.join("\r\n"),
    type: sessionDescription.type,
  });
}
