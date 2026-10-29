const { Pinecone } = require("@pinecone-database/pinecone")

const pc = new Pinecone({apiKey: process.env.PINECONE_API_KEY});

//index
const gptCloneIndex = pc.Index('chatgpt-clone')


//creating memory
async function createMemory({vectors, metadata, messageId}){

    if (!Array.isArray(vectors) || vectors.length === 0) {
        throw new Error("Cannot save memory: embedding vector is empty");
    }
    await gptCloneIndex.upsert({
    records: [{
        id: String(messageId),
        values: vectors,
        metadata
    }]
});
}

//querry
async function queryMemory({queryVector, limit = 5, metadata}) {
    
    const data = await gptCloneIndex.query({
        vector: queryVector,
        topK: limit,
        filter: metadata ? metadata: undefined,
        includeMetadata: true
    })

    return data.matches
}

async function deleteMemoriesByIds(ids) {
    const uniqueIds = [...new Set(ids.map(String))]
    for (let offset = 0; offset < uniqueIds.length; offset += 1000) {
        await gptCloneIndex.deleteMany({ ids: uniqueIds.slice(offset, offset + 1000) })
    }
}

module.exports = {
    createMemory,
    queryMemory,
    deleteMemoriesByIds
}
