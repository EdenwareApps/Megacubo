import Streamer from "./streamer.js"
import StreamerNetWorkProxy from './utils/network-proxy.js'
import StreamerProxy from './utils/proxy.js'
import StreamerFFmpeg from './utils/ffmpeg.js'

const streamer = new Streamer()

streamer.Streamer = Streamer
streamer.Proxy = StreamerProxy
streamer.FFmpeg = StreamerFFmpeg // ref for other bundles
streamer.NetWorkProxy = StreamerNetWorkProxy // ref for other bundles

export default streamer
