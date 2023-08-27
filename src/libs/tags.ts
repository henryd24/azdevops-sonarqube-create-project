import fetch from 'node-fetch';

export class Tags{
    baseURL: string;
    sonarToken:string;
    constructor(baseURL:string,sonarToken:string){
        this.baseURL = baseURL;
        this.sonarToken = sonarToken;
    }
    async setTags(serviceName: string|undefined,tags: string|undefined){
        const setQualityGate: string = `${this.baseURL}/api/project_tags/set?project=${serviceName}&tags=${tags}`;
        const base64_token: string = Buffer.from(this.sonarToken+':').toString('base64')
        await fetch(setQualityGate, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': 'Basic ' + base64_token
            }
        })
        .then(response => response.status)
        .then(statusCode =>{
            if(statusCode == 204){
                console.info(`Tags: ${tags} were set correctly`)
            }else{
                console.warn(`Could not configure tags, error code: ${statusCode}`)
            }
        })
        .catch(error => {
            console.error(error);
        })
    }
}