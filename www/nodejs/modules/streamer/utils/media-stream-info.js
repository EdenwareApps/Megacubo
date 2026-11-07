/**
 * Lightweight MPEG-TS inspection used while tuning.
 *
 * Some IPTV providers answer with a perfectly valid, live, playable HLS stream
 * whose segments are a single frozen image (usually a "your list expired / pay
 * for a subscription" card). Nothing in the playlist reveals it, so the only
 * way to spot them before playback is to look inside a segment.
 *
 * This module parses just enough of the transport stream (PAT/PMT) to know
 * which elementary streams exist and what resolution/frame rate the video has,
 * so the caller can compare it against the real bitrate of the segment.
 */

const TS_PACKET_SIZE = 188
const SYNC_BYTE = 0x47
const MAX_PACKETS = 2048
const MAX_ES_BYTES = 65536

// bits per pixel per frame below which a live stream is considered a still image
export const PLACEHOLDER_MAX_BPP = 0.015

// newer codecs need far less bits for the same quality, relax the threshold for them
const CODEC_BPP_FACTOR = {
    h264: 1,
    hevc: 0.6,
    mpeg2video: 1.2,
    mpeg4: 0.9
}

const VIDEO_STREAM_TYPES = {
    0x01: 'mpeg1video',
    0x02: 'mpeg2video',
    0x10: 'mpeg4',
    0x1b: 'h264',
    0x24: 'hevc',
    0x42: 'cavs',
    0xea: 'vc1',
    0xd1: 'dirac',
    0xd2: 'dirac'
}

const AUDIO_STREAM_TYPES = {
    0x03: 'mp2',
    0x04: 'mp2',
    0x0f: 'aac',
    0x11: 'aac', // LATM
    0x1c: 'aac', // MPEG-4 raw audio
    0x81: 'ac3',
    0x82: 'dts',
    0x85: 'dts',
    0x86: 'dts',
    0x87: 'eac3'
}

// descriptors carried inside a 0x06 private data stream
const AUDIO_DESCRIPTORS = {
    0x6a: 'ac3',
    0x7a: 'eac3',
    0x7b: 'dts',
    0x7c: 'aac'
}

const AUDIO_REGISTRATIONS = {
    'AC-3': 'ac3',
    'EAC3': 'eac3',
    'DTS1': 'dts',
    'DTS2': 'dts',
    'DTS3': 'dts',
    'Opus': 'opus'
}

class BitReader {
    constructor(buffer) {
        this.buffer = buffer
        this.pos = 0
    }
    bit() {
        const byte = this.buffer[this.pos >> 3]
        if (typeof(byte) != 'number') {
            throw new Error('bit reader out of bounds')
        }
        const bit = (byte >> (7 - (this.pos & 7))) & 1
        this.pos++
        return bit
    }
    bits(count) {
        let value = 0
        for (let i = 0; i < count; i++) {
            value = (value * 2) + this.bit()
        }
        return value
    }
    ue() {
        let zeros = 0
        while (!this.bit()) {
            if (++zeros > 32) {
                throw new Error('invalid exp-golomb code')
            }
        }
        return ((2 ** zeros) - 1) + this.bits(zeros)
    }
    se() {
        const value = this.ue()
        return (value % 2) ? (value + 1) / 2 : -(value / 2)
    }
}

function unescapeRBSP(buffer) {
    const out = Buffer.allocUnsafe(buffer.length)
    let len = 0, i = 0
    while (i < buffer.length) {
        if (i + 2 < buffer.length && !buffer[i] && !buffer[i + 1] && buffer[i + 2] == 0x03) {
            out[len++] = 0
            out[len++] = 0
            i += 3
        } else {
            out[len++] = buffer[i++]
        }
    }
    return out.subarray(0, len)
}

function skipScalingList(reader, size) {
    let last = 8, next = 8
    for (let i = 0; i < size; i++) {
        if (next) {
            next = (last + reader.se() + 256) % 256
        }
        last = next ? next : last
    }
}

function parseH264VUI(reader) {
    if (reader.bit()) { // aspect_ratio_info_present_flag
        if (reader.bits(8) == 255) { // aspect_ratio_idc == Extended_SAR
            reader.bits(16)
            reader.bits(16)
        }
    }
    if (reader.bit()) { // overscan_info_present_flag
        reader.bit()
    }
    if (reader.bit()) { // video_signal_type_present_flag
        reader.bits(3) // video_format
        reader.bit() // video_full_range_flag
        if (reader.bit()) { // colour_description_present_flag
            reader.bits(8)
            reader.bits(8)
            reader.bits(8)
        }
    }
    if (reader.bit()) { // chroma_loc_info_present_flag
        reader.ue()
        reader.ue()
    }
    if (reader.bit()) { // timing_info_present_flag
        const numUnitsInTick = reader.bits(32)
        const timeScale = reader.bits(32)
        reader.bit() // fixed_frame_rate_flag
        if (numUnitsInTick > 0 && timeScale > 0) {
            return timeScale / (2 * numUnitsInTick)
        }
    }
    return 0
}

/**
 * Parses an H.264 SPS NAL unit (including its 1 byte NAL header).
 * Returns { width, height, fps, profile } or null.
 */
export function parseH264SPS(nal) {
    if (!nal || nal.length < 4) {
        return null
    }
    let reader
    try {
        reader = new BitReader(unescapeRBSP(nal.subarray(1)))
    } catch (err) {
        return null
    }
    try {
        const profile = reader.bits(8)
        reader.bits(8) // constraint flags + reserved
        const level = reader.bits(8)
        reader.ue() // seq_parameter_set_id
        let chromaFormatIdc = 1, separateColourPlane = 0
        if ([100, 110, 122, 244, 44, 83, 86, 118, 128, 138, 139, 134, 135].includes(profile)) {
            chromaFormatIdc = reader.ue()
            if (chromaFormatIdc == 3) {
                separateColourPlane = reader.bit()
            }
            reader.ue() // bit_depth_luma_minus8
            reader.ue() // bit_depth_chroma_minus8
            reader.bit() // qpprime_y_zero_transform_bypass_flag
            if (reader.bit()) { // seq_scaling_matrix_present_flag
                const lists = (chromaFormatIdc != 3) ? 8 : 12
                for (let i = 0; i < lists; i++) {
                    if (reader.bit()) {
                        skipScalingList(reader, (i < 6) ? 16 : 64)
                    }
                }
            }
        }
        reader.ue() // log2_max_frame_num_minus4
        const pocType = reader.ue()
        if (pocType == 0) {
            reader.ue() // log2_max_pic_order_cnt_lsb_minus4
        } else if (pocType == 1) {
            reader.bit() // delta_pic_order_always_zero_flag
            reader.se()
            reader.se()
            const cycles = Math.min(reader.ue(), 256)
            for (let i = 0; i < cycles; i++) {
                reader.se()
            }
        }
        reader.ue() // max_num_ref_frames
        reader.bit() // gaps_in_frame_num_value_allowed_flag
        const widthMbs = reader.ue() + 1
        const heightMapUnits = reader.ue() + 1
        const frameMbsOnly = reader.bit()
        if (!frameMbsOnly) {
            reader.bit() // mb_adaptive_frame_field_flag
        }
        reader.bit() // direct_8x8_inference_flag
        let cropLeft = 0, cropRight = 0, cropTop = 0, cropBottom = 0
        if (reader.bit()) { // frame_cropping_flag
            cropLeft = reader.ue()
            cropRight = reader.ue()
            cropTop = reader.ue()
            cropBottom = reader.ue()
        }
        const fps = reader.bit() ? (parseH264VUI(reader) || 0) : 0
        const monochrome = !chromaFormatIdc || separateColourPlane
        const subWidthC = (!monochrome && chromaFormatIdc == 2) ? 2 : (monochrome ? 1 : 2)
        const subHeightC = (!monochrome && chromaFormatIdc == 2) ? 1 : (monochrome ? 1 : 2)
        const cropUnitX = monochrome ? 1 : subWidthC
        const cropUnitY = (monochrome ? 1 : subHeightC) * (2 - frameMbsOnly)
        const width = (widthMbs * 16) - (cropUnitX * (cropLeft + cropRight))
        const height = ((2 - frameMbsOnly) * heightMapUnits * 16) - (cropUnitY * (cropTop + cropBottom))
        if (!(width > 0) || !(height > 0)) {
            return null
        }
        return { width, height, fps: Math.round(fps * 100) / 100 || 0, profile, level }
    } catch (err) {
        return null
    }
}

function findSyncOffset(buffer) {
    const limit = Math.min(TS_PACKET_SIZE, buffer.length - (TS_PACKET_SIZE * 2))
    for (let offset = 0; offset < limit; offset++) {
        if (buffer[offset] !== SYNC_BYTE) {
            continue
        }
        if (buffer[offset + TS_PACKET_SIZE] === SYNC_BYTE && buffer[offset + (TS_PACKET_SIZE * 2)] === SYNC_BYTE) {
            return offset
        }
    }
    return -1
}

function readSection(payload) {
    if (!payload || !payload.length) {
        return null
    }
    const start = 1 + payload[0] // skip pointer_field
    if (start + 3 > payload.length) {
        return null
    }
    const tableId = payload[start]
    const sectionLength = ((payload[start + 1] & 0x0f) << 8) | payload[start + 2]
    const bodyStart = start + 3
    const bodyEnd = Math.min(bodyStart + sectionLength - 4, payload.length) // drop CRC32
    if (bodyEnd <= bodyStart) {
        return null
    }
    return { tableId, data: payload.subarray(bodyStart, bodyEnd) }
}

function parsePAT(payload) {
    const section = readSection(payload)
    if (!section || section.tableId !== 0x00) {
        return []
    }
    const data = section.data, pids = []
    for (let i = 5; i + 4 <= data.length; i += 4) {
        const program = data.readUInt16BE(i), pid = ((data[i + 2] & 0x1f) << 8) | data[i + 3]
        if (program !== 0 && pid !== 0x1fff) { // program 0 is the network information table
            pids.push(pid)
        }
    }
    return pids
}

function parsePMT(payload) {
    const section = readSection(payload)
    if (!section || section.tableId !== 0x02) {
        return []
    }
    const data = section.data
    if (data.length < 9) {
        return []
    }
    // program_number(2) version(1) section_number(1) last_section_number(1) pcr_pid(2) program_info_length(2)
    const infoLength = ((data[7] & 0x0f) << 8) | data[8]
    const streams = []
    let pos = 9 + infoLength
    while (pos + 5 <= data.length) {
        const type = data[pos]
        const pid = ((data[pos + 1] & 0x1f) << 8) | data[pos + 2]
        const esLength = ((data[pos + 3] & 0x0f) << 8) | data[pos + 4]
        const esStart = pos + 5, esEnd = Math.min(esStart + esLength, data.length)
        streams.push({ type, pid, descriptors: data.subarray(esStart, esEnd) })
        pos = esStart + esLength
    }
    return streams
}

function classifyStream(stream) {
    if (VIDEO_STREAM_TYPES[stream.type]) {
        return { kind: 'video', codec: VIDEO_STREAM_TYPES[stream.type] }
    }
    if (AUDIO_STREAM_TYPES[stream.type]) {
        return { kind: 'audio', codec: AUDIO_STREAM_TYPES[stream.type] }
    }
    if (stream.type === 0x06) { // private data, look at descriptors
        const desc = stream.descriptors || Buffer.alloc(0)
        let pos = 0
        while (pos + 2 <= desc.length) {
            const tag = desc[pos], len = desc[pos + 1]
            const body = desc.subarray(pos + 2, Math.min(pos + 2 + len, desc.length))
            if (AUDIO_DESCRIPTORS[tag]) {
                return { kind: 'audio', codec: AUDIO_DESCRIPTORS[tag] }
            }
            if (tag === 0x05 && body.length >= 4) { // registration descriptor
                const codec = AUDIO_REGISTRATIONS[body.subarray(0, 4).toString('latin1')]
                if (codec) {
                    return { kind: 'audio', codec }
                }
            }
            pos += 2 + len
        }
    }
    return { kind: 'other', codec: null }
}

function collectPayload(buffer, offset, pid, limit) {
    const parts = []
    let total = 0
    for (let pos = offset; pos + TS_PACKET_SIZE <= buffer.length; pos += TS_PACKET_SIZE) {
        if (buffer[pos] !== SYNC_BYTE) {
            break
        }
        const packetPid = ((buffer[pos + 1] & 0x1f) << 8) | buffer[pos + 2]
        if (packetPid !== pid) {
            continue
        }
        const afc = (buffer[pos + 3] >> 4) & 3
        if (!(afc & 1)) {
            continue
        }
        let start = pos + 4
        if (afc & 2) {
            start += 1 + buffer[pos + 4]
        }
        if (start >= pos + TS_PACKET_SIZE) {
            continue
        }
        const chunk = buffer.subarray(start, pos + TS_PACKET_SIZE)
        parts.push(chunk)
        total += chunk.length
        if (total >= limit) {
            break
        }
    }
    return Buffer.concat(parts)
}

/**
 * Scans a NAL byte stream (Annex B) for the first SPS of the given codec.
 */
function findSPS(es, codec) {
    const type = (codec == 'hevc') ? 33 : 7
    const mask = (codec == 'hevc') ? 0x3f : 0x1f
    let i = 0
    while (i + 5 < es.length) {
        if (!es[i] && !es[i + 1]) {
            let header
            if (es[i + 2] === 1) {
                header = i + 3
            } else if (es[i + 2] === 0 && es[i + 3] === 1) {
                header = i + 3 + 1
            } else {
                i++
                continue
            }
            if (header < es.length && (es[header] & mask) === type) {
                let end = header + 1
                while (end + 3 < es.length) {
                    if (!es[end] && !es[end + 1] && (es[end + 2] === 1 || (es[end + 2] === 0 && es[end + 3] === 1))) {
                        break
                    }
                    end++
                }
                return es.subarray(header, Math.min(end, header + 512))
            }
            i = header + 1
            continue
        }
        i++
    }
    return null
}

/**
 * Inspects an MPEG-TS sample.
 * Returns null when the sample is not a transport stream.
 */
export function analyzeMediaSample(buffer, opts = {}) {
    if (!Buffer.isBuffer(buffer) || buffer.length < TS_PACKET_SIZE * 2) {
        return null
    }
    const offset = findSyncOffset(buffer)
    if (offset < 0) {
        return null
    }
    const pmtPids = [], streams = []
    let pmtPid = -1, packets = 0
    for (let pos = offset; pos + TS_PACKET_SIZE <= buffer.length && packets < (opts.maxPackets || MAX_PACKETS); pos += TS_PACKET_SIZE) {
        packets++
        if (buffer[pos] !== SYNC_BYTE) {
            break
        }
        const pid = ((buffer[pos + 1] & 0x1f) << 8) | buffer[pos + 2]
        if (pid === 0x1fff) {
            continue
        }
        const afc = (buffer[pos + 3] >> 4) & 3
        if (!(afc & 1)) {
            continue
        }
        let start = pos + 4
        if (afc & 2) {
            start += 1 + buffer[pos + 4]
        }
        if (start >= pos + TS_PACKET_SIZE) {
            continue
        }
        const payload = buffer.subarray(start, pos + TS_PACKET_SIZE)
        if (pid === 0) {
            if (!pmtPids.length) {
                pmtPids.push(...parsePAT(payload))
            }
            continue
        }
        if (pmtPid === -1 && pmtPids.includes(pid)) {
            const found = parsePMT(payload)
            if (found.length) {
                pmtPid = pid
                streams.push(...found)
            }
        }
        if (pmtPid !== -1 && pid !== pmtPid) {
            break // PMT already read, no need to walk the whole sample
        }
    }
    if (!streams.length) {
        return null
    }
    const media = {
        container: 'ts',
        hasVideo: false,
        hasAudio: false,
        videoCodec: null,
        audioCodecs: [],
        width: 0,
        height: 0,
        fps: 0,
        videoPid: -1,
        streams: []
    }
    streams.forEach(stream => {
        const { kind, codec } = classifyStream(stream)
        media.streams.push({ pid: stream.pid, type: stream.type, kind, codec })
        if (kind === 'video') {
            if (!media.hasVideo) {
                media.hasVideo = true
                media.videoCodec = codec
                media.videoPid = stream.pid
            }
        } else if (kind === 'audio') {
            media.hasAudio = true
            if (codec && !media.audioCodecs.includes(codec)) {
                media.audioCodecs.push(codec)
            }
        }
    })
    if (media.hasVideo && ['h264', 'hevc'].includes(media.videoCodec)) {
        const es = collectPayload(buffer, offset, media.videoPid, opts.maxEsBytes || MAX_ES_BYTES)
        const sps = findSPS(es, media.videoCodec)
        const parsed = sps && media.videoCodec === 'h264' ? parseH264SPS(sps) : null
        if (parsed) {
            media.width = parsed.width
            media.height = parsed.height
            media.fps = parsed.fps
            media.profile = parsed.profile
            media.level = parsed.level
        }
    }
    return media
}

/**
 * Compares the real bitrate of a segment against its resolution/frame rate.
 * A still image needs almost no bits, so a very low value means the "live"
 * stream is actually a frozen card.
 *
 * Returns null when there is not enough information to judge.
 */
export function detectPlaceholderStream({ media, contentLength, duration, maxBpp } = {}) {
    if (!media || !media.hasVideo || !media.width || !media.height) {
        return null
    }
    if (!(contentLength > 0) || !(duration > 0)) {
        return null
    }
    const fps = media.fps > 0 ? media.fps : 25
    const bitrate = Math.round((contentLength * 8) / duration)
    const bpp = bitrate / (media.width * media.height * fps)
    const factor = CODEC_BPP_FACTOR[media.videoCodec] || 1
    const limit = ((typeof(maxBpp) == 'number' && maxBpp > 0) ? maxBpp : PLACEHOLDER_MAX_BPP) * factor
    if (!(bpp < limit)) {
        return null
    }
    return {
        reason: media.hasAudio ? 'still-image' : 'silent-still-image',
        bitrate,
        bpp: Math.round(bpp * 100000) / 100000,
        maxBpp: Math.round(limit * 100000) / 100000,
        width: media.width,
        height: media.height,
        fps,
        hasAudio: media.hasAudio,
        videoCodec: media.videoCodec
    }
}

/**
 * Guesses the average segment duration of an HLS media playlist.
 */
export function segmentDurationFromPlaylist(playlist) {
    const text = String(playlist || '')
    let duration = 0
    const infos = text.match(/#EXTINF:\s*[\d.]+/ig)
    if (infos) {
        const values = infos.map(line => parseFloat(line.split(':')[1])).filter(value => value > 0)
        if (values.length) {
            duration = values.reduce((acc, value) => acc + value, 0) / values.length
        }
    }
    if (!duration) {
        const target = text.match(/#EXT-X-TARGETDURATION:\s*([\d.]+)/i)
        if (target) {
            duration = parseFloat(target[1])
        }
    }
    return duration || 0
}
