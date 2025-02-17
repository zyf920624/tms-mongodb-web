import { ResultData, ResultFault } from 'tms-koa'
import Base from 'tmw-kit/dist/ctrl/base.js'
import DocumentHelper from '../documentHelper.js'
import { ModelDoc, ModelSchema, makeTagsFilter, makeProjection } from 'tmw-kit'
import Debug from 'debug'

/**
 * 开放端文档对象控制器
 */
class Document extends Base {
  docHelper: DocumentHelper
  modelDoc: ModelDoc

  constructor(ctx, client, dbContext, mongoClient, pushContext, fsContext?) {
    super(ctx, client, dbContext, mongoClient, pushContext, fsContext)
    this.docHelper = new DocumentHelper(this)
    this.modelDoc = new ModelDoc(this.mongoClient, this.bucket, this.client)
  }
  /**
   * 检查请求是否来源于可信主机，符合就跳过认证机制
   */
  static tmsAuthTrustedHosts() {
    return true
  }
  /**
   * 根据ID返回单个文档的数据
   * @returns
   */
  async get() {
    const { id, fields, debug } = this.request.query

    let deglog // 输出调试信息
    if (/y|yes|true/i.test(debug)) deglog = Debug('tmw:controllers:open:get')

    const existCl = await this.docHelper.findRequestCl()

    let projection = makeProjection(fields)
    if (deglog && fields)
      deglog('请求返回的字段', fields, JSON.stringify(projection))

    let existDoc = await this.modelDoc.byId(existCl, id, projection)

    if (!existDoc) return new ResultFault('指定的文档不存在')

    return new ResultData(existDoc)
  }
  /**
   * 根据条件返回符合的文档列表
   * @returns
   */
  async list() {
    const { page, size, tags, fields, debug } = this.request.query

    let deglog // 输出调试信息
    if (/y|yes|true/i.test(debug))
      deglog = Debug('tmw:controllers:open:document:list')

    let projection = makeProjection(fields)
    if (deglog && fields)
      deglog('请求返回的字段', fields, JSON.stringify(projection))

    const existCl = await this.docHelper.findRequestCl()

    let { filter: rawFilter, orderBy } = this.request.body

    // 标签加入筛选条件
    let filter
    if (Array.isArray(tags) && tags.length)
      filter = makeTagsFilter(tags, rawFilter)
    else filter = rawFilter

    if (deglog && rawFilter)
      deglog('请求的过滤条件', rawFilter, JSON.stringify(filter))

    let [ok, result] = await this.modelDoc.list(
      existCl,
      { filter, orderBy },
      { page, size },
      true,
      projection
    )

    if (ok === false) return new ResultFault(result)

    return new ResultData(result)
  }
  /**
   * 在指定的集合中新建文档
   */
  async create() {
    const existCl = await this.docHelper.findRequestCl()

    const { name: clName, schema_id } = existCl
    let data = this.request.body

    const modelSchema = new ModelSchema(
      this.mongoClient,
      this.bucket,
      this.client
    )

    // 集合的schema定义
    let clSchema
    if (schema_id && typeof schema_id === 'string')
      clSchema = await modelSchema.bySchemaId(schema_id)

    /**在数据库中创建记录*/
    const createOne = async (doc) => {
      // 加工数据
      this.modelDoc.processBeforeStore(doc, 'insert', clSchema)

      return this.docHelper
        .findSysColl(existCl)
        .insertOne(doc)
        .then(async (r) => {
          await this.modelDoc.dataActionLog(
            r.ops,
            '创建',
            existCl.db.name,
            clName
          )
          return doc
        })
    }

    let result: any
    if (Array.isArray(data)) {
      result = []
      for (let i = 0; i < data.length; i++) {
        let newDoc = await createOne(data[i])
        result.push(newDoc)
      }
    } else if (data && typeof data === 'object') {
      let newDoc = await createOne(data)
      result = newDoc
    }

    return new ResultData(result)

    // 去重校验
    // const result = this.modelDoc.findUnRepeatRule(existCl)
    // if (result[0]) {
    //   const { dbName, clName: collName, keys, insert } = result[1]
    //   const curDoc = [doc]
    //   const curConfig = {
    //     config: {
    //       columns: keys,
    //       db: dbName,
    //       cl: collName,
    //       insert: insert,
    //     },
    //   }
    //   const repeated = await unrepeat(this, curDoc, curConfig)
    //   if (repeated.length === 0)
    //     return new ResultFault('添加失败,当前数据已存在')
    // }
    // 补充公共属性
    // if (extensionInfo) {
    //   const { info, schemaId } = extensionInfo
    //   if (schemaId) {
    //     const modelSchema = new ModelSchema(
    //       this['mongoClient'],
    //      this.bucketObj,
    //       this['client']
    //     )
    //     const publicSchema = await modelSchema.bySchemaId(schemaId)
    //     Object.keys(publicSchema).forEach((schema) => {
    //       doc[schema] = info[schema] ? info[schema] : ''
    //     })
    //   }
    // }
  }
}

export default Document
