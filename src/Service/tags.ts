import fetch from 'node-fetch';

export class Tags{
    baseURL: string;
    constructor(){
        this.baseURL = "https://sonarcloud.io";
    }
    async setTags(sonarToken:string|undefined, sonarOrganization: string|undefined ,serviceName: string|undefined,tags: string|undefined){
        const setQualityGate: string = `${this.baseURL}/api/project_tags/set?organization=${sonarOrganization}&project=${serviceName}&tags=${tags}`;
        const base64_token: string = Buffer.from(sonarToken+':').toString('base64')
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