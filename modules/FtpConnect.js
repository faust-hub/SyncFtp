const fs = require('fs')
const ftp = require('ftp')
const getStream = require('get-stream')

const ERR_INCORRECT_PARAM = 995
const ERR_GET_FILE_STREAM = 996
const ERR_FAIL_RESPONSE = 997
const ERR_TIMEOUT = 998

const FORCE_CLOSE_CONNECT = 999

module.exports = class FtpConnect {

    constructor (inFtpParams, dbgLog) {
        this.params = inFtpParams
        this.poolCmd = {}
        this.connections = new Array(this.params.numThreads + 5).fill({}).map(rec => { return { idCmd: null, errCode: null, ftpParams: null, connect: null } })

        // this.dbgOut = (...args) => dbgLog.out(...args)
        this.dbgOut = (...args) => {}
    }

    async runCommand(inParams) {
        let idCmd 
        do { idCmd = new Date().valueOf() } while (this.poolCmd[idCmd])

        return new Promise(async resolve => {
            // this.dbgOut('IN CMD:', inParams.cmd, inParams.args, idCmd)
            
            this.poolCmd[idCmd] = {
                indConnect: -1,                
                cntTryRequest: 0,
                temporaryConnect: inParams.temporaryConnect,                

                execCmd: (thisId) => {
                    let recCmd = this.poolCmd[thisId]                    
                    if (inParams.onProgress) inParams.onProgress(inParams.objectId, 0)

                    let tmrTimeOut, timeOut
                    let arrayArgs = inParams.args ? (Array.isArray(inParams.args) ? inParams.args : [inParams.args]) : []
                    const setHandlerTimeOut = () => { tmrTimeOut = setTimeout(() => this.runFinallyCmd(thisId, ERR_TIMEOUT, null, true), timeOut)}

                    if (inParams.cmd === 'put') {
                        timeOut = this.params.timeOutTransfer

                        let pathFile = (typeof arrayArgs[0] === 'string') ? arrayArgs[0] : arrayArgs[0].path                        
                        if (pathFile) {
                            arrayArgs[0] = fs.createReadStream(pathFile)

                            arrayArgs[0].on('data', (data) => {
                                clearTimeout(tmrTimeOut)
                                setHandlerTimeOut()
                                if (inParams.onProgress) inParams.onProgress(inParams.objectId, data.length)
                            })
                    
                            arrayArgs[0].once('close', () => clearTimeout(tmrTimeOut))
                        } else this.runFinallyCmd(thisId, ERR_INCORRECT_PARAM, null, false)                        
                    } else timeOut = (recCmd.temporaryConnect && recCmd.temporaryConnect.timeOutRequest) || this.params.timeOutRequest
                    
                    setHandlerTimeOut()

                    this.connections[recCmd.indConnect].connect[inParams.cmd](...arrayArgs.concat(async (...args) => {                        
                        clearTimeout(tmrTimeOut)
                        
                        let result = this.parseResult(args)
                        if (inParams.isReadStream && !result.error) result = await this.getFileStream(result.data, inParams.objectId, inParams.onProgress)

                        this.runFinallyCmd(thisId, result.error, result.data, recCmd.temporaryConnect)
                    }))
                },

                finallyCmd: (errorCode, resultCmd) => resolve({ error: errorCode, data: resultCmd })                 
            }

            this.poolCmdProcessing()
        })
    }

    runExecCmd(idCmd) {        
        if (idCmd && this.poolCmd[idCmd]) {
            this.dbgOut(`[${this.poolCmd[idCmd].indConnect}] RUN #${idCmd} - try: ${this.poolCmd[idCmd].cntTryRequest}`)

            this.poolCmd[idCmd].execCmd(idCmd)
        }
    }

    runFinallyCmd(idCmd, errorCode, resultCmd, isDestroyConnect) {
        let recCmd = this.poolCmd[idCmd]
        if (recCmd) {
            this.dbgOut(`[${recCmd.indConnect}] END #${idCmd} - err: ${errorCode}, res: ${resultCmd ? resultCmd.length : resultCmd}, close: ${isDestroyConnect}`)
            
            if (errorCode && (recCmd.cntTryRequest < ((recCmd.temporaryConnect && recCmd.temporaryConnect.limTryRequest) || this.params.limTryRequest))) {
                this.closeConnect(recCmd.indConnect, true)
                recCmd.indConnect = -1
            } else {
                this.closeConnect(recCmd.indConnect, isDestroyConnect || errorCode)
                recCmd.finallyCmd(errorCode, resultCmd)
                delete this.poolCmd[idCmd]                
            }

            this.poolCmdProcessing()
        }
    }

    poolCmdProcessing() {        
        for (let idCmd in this.poolCmd) {            
            let recCmd = this.poolCmd[idCmd]

            if (recCmd.indConnect < 0) {
                this.dbgOut('TRY START:', idCmd, '(free: ' + this.connections.filter(rec => !rec.idCmd).length + ')')

                if (!this.connections.some((recConnection, indConnect) => { 
                    if (!recConnection.errCode && !recConnection.idCmd) {                                              
                        recConnection.idCmd = idCmd
                        recConnection.ftpParams = recCmd.temporaryConnect || this.params

                        recCmd.indConnect = indConnect
                        recCmd.cntTryRequest++

                        this.activateConnect(indConnect)
                        return true
                    }
                })) break                    
            }
        }
    }

    activateConnect(indConnect) {        
        let recConnect = this.connections[indConnect]

        if (!recConnect.connect) recConnect.connect = new ftp()

        if (!recConnect.connect.connected) {
            let tmrTimeOut = setTimeout(() => this.runFinallyCmd(recConnect.idCmd, ERR_TIMEOUT, null, true), recConnect.ftpParams.timeOutRequest)

            recConnect.connect.removeAllListeners()

            recConnect.connect.on('error', (error) => {
                clearTimeout(tmrTimeOut)
                this.runFinallyCmd(recConnect.idCmd, error.code, null, true)
            })

            recConnect.connect.once('ready', () => {
                clearTimeout(tmrTimeOut)
                this.runExecCmd(recConnect.idCmd)
            })

            recConnect.connect.once('close', () => {
                this.dbgOut(`[${indConnect}] CLOSE CONNECT`)

                clearTimeout(tmrTimeOut)
                this.closeConnect(indConnect, false)
                this.poolCmdProcessing()
            })

            recConnect.connect.connect(recConnect.ftpParams.connection)
        } else this.runExecCmd(recConnect.idCmd)
    }

    closeAllConnects() {
        for (let indConnect in this.connections) this.closeConnect(indConnect, true)
    }

    closeConnect(indConnect, isDestroy) {
        this.dbgOut(`[${indConnect}] ${isDestroy ? 'DESTROY' : 'FREE'} CONNECT`)

        let recConnect = this.connections[indConnect]
        if (recConnect) {
            recConnect.idCmd = null
            recConnect.ftpParams = null

            if (isDestroy && recConnect.connect) {
                recConnect.errCode = FORCE_CLOSE_CONNECT
                recConnect.connect.destroy()
            } else recConnect.errCode = null
        }
    }    

    getFileStream(inStream, objectId, onProgress) {
        return new Promise(resolve => {
            if (inStream) {
                let tmrTimeOut = setTimeout(() => resolve({ error: ERR_TIMEOUT }), this.params.timeOutTransfer)

                inStream.on('data', (data) => {
                    clearTimeout(tmrTimeOut)
                    tmrTimeOut = setTimeout(() => resolve({ error: ERR_TIMEOUT }), this.params.timeOutTransfer)
                    if (onProgress) onProgress(objectId, data.length)
                })

                inStream.once('error', () => {
                    clearTimeout(tmrTimeOut)
                    resolve({ error: ERR_GET_FILE_STREAM })
                })

                inStream.once('close', () => clearTimeout(tmrTimeOut))
                
                let res = {}                
                getStream.buffer(inStream)
                    .then((data) => res.data = data)
                    .catch(() => res.error = ERR_GET_FILE_STREAM)
                    .finally(() => resolve(res))

            } else resolve({ error: ERR_GET_FILE_STREAM })
        })
    }

    parseResult(inData) {
        return !inData ? { error: ERR_FAIL_RESPONSE } : { 
            data: (inData.length > 1) && inData[1], 
            error: (inData.length > 0)
                ? ((typeof inData[0] === 'object') && inData[0].code) ? inData[0].code : inData[0]
                : null
        }        
    }

}